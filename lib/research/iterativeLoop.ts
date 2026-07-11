// ITERATIVE evidence-sufficiency research LOOP — the deterministic loop-control
// half of the deep-research engine.
//
// Assimilates open_deep_research's supervisor loop (backend/engines/open_deep_research):
// upstream ODR runs a supervisor that, after each ConductResearch pass, asks an LLM
// `should_continue` whether to research more or write the final report. PaperTrail's
// moat rule forbids an LLM anywhere in a score/ranking/verdict/loop-control decision, so
// this module re-implements that loop as a DETERMINISTIC STATE MACHINE.
//
// Given the evidence accrued SO FAR per round (pooled study count, total participants,
// heterogeneity I², open contradictions), it REUSES the field-standard sufficiency gate
// `evidenceSufficiency` from lib/evidencePipeline.ts (which it does NOT edit) to decide,
// each round, `sufficient` (stop) vs. `insufficient` (continue). When it continues it
// emits ONE concrete widen action — broaden the query, add a facet, or raise the
// retrieval limit — chosen by a fixed priority over the FAILING criteria. The loop is
// HARD-CAPPED at MAX_ROUNDS so it always terminates.
//
// This mirrors backend/engines/open_deep_research/papertrail_iterative.py field-for-field
// (see that engine's PAPERTRAIL.md). NO LLM in the stop/continue/widen decision: given
// the same per-round stats it always returns the same decisions and widen actions. Pure:
// no I/O, no mutation of its inputs. Honest insufficiency — when the cap is hit while
// still insufficient it stops with an explicit `cap_reached` reason rather than pretending
// the evidence is sufficient.

import {
  evidenceSufficiency,
  type EvidenceSufficiencyResult,
} from "../evidencePipeline";

// Hard cap on rounds — MUST match MAX_ROUNDS in papertrail_iterative.py. The loop always
// terminates: the final round (supplied-or-cap) can only stop, never continue.
export const MAX_ROUNDS = 3;

// The concrete widen actions the loop may emit when it continues. Fixed vocabulary so a
// UI (and the Python mirror) can switch on them exhaustively.
export type WidenActionType = "raise_limit" | "add_facet" | "broaden_query";

export interface WidenAction {
  type: WidenActionType;
  detail: string;
}

// Per-round accrued evidence stats — the numbers the deterministic engines already
// produced. `k` is the pooled study count (NOT sources retrieved); `iSquared` is null
// when heterogeneity could not be computed; `openContradictions` defaults to 0.
export interface RoundStats {
  k: number;
  participants: number;
  iSquared?: number | null;
  openContradictions?: number;
}

export type RoundDecision = "continue" | "stop";
export type StopReason = "sufficient" | "cap_reached";

export interface RoundResult {
  round: number;
  sufficient: boolean;
  decision: RoundDecision;
  reason: string;
  widenAction: WidenAction | null;
  criteria: EvidenceSufficiencyResult["criteria"];
}

export interface IterativeFinal {
  decision: "stop";
  stopReason: StopReason;
  roundsUsed: number;
  sufficient: boolean;
}

export interface IterativePlan {
  rounds: RoundResult[];
  final: IterativeFinal;
  meta: {
    maxRounds: number;
    roundsSupplied: number;
  };
}

/**
 * Pick ONE next widen action from the failing sufficiency criteria, by a FIXED priority
 * (NOT an LLM). Rationale — each criterion has a distinct cheapest remedy, applied to the
 * *primary* shortfall so the next round is a targeted widen, not a blind re-run:
 *   1. too few studies      -> raise the retrieval limit (pull more candidate sources)
 *   2. too few participants  -> add a facet (larger trials / pooled cohorts / phase 3)
 *   3. high/unknown I²       -> add a facet (constrain population/comparator)
 *   4. open contradictions   -> broaden the query (surface adjudicating evidence)
 *
 * Only called for an insufficient round with another round remaining, so at least one
 * criterion is failing. Deterministic and pure. Mirrors decide_widen_action in the
 * Python engine.
 */
export function decideWidenAction(
  criteria: EvidenceSufficiencyResult["criteria"]
): WidenAction {
  if (!criteria.enoughStudies) {
    return {
      type: "raise_limit",
      detail:
        "Too few pooled studies — raise the retrieval limit to pull more candidate primary sources into the next pass.",
    };
  }
  if (!criteria.enoughParticipants) {
    return {
      type: "add_facet",
      detail:
        "Too few total participants — add a facet targeting larger trials or pooled cohorts (e.g. phase-3 / multi-centre) in the next pass.",
    };
  }
  if (!criteria.acceptableHeterogeneity) {
    return {
      type: "add_facet",
      detail:
        "Heterogeneity is high or un-assessable — add a facet constraining the population or comparator to retrieve a more homogeneous evidence set.",
    };
  }
  // By construction the only remaining failing criterion is open contradictions.
  return {
    type: "broaden_query",
    detail:
      "Open contradictions between sources — broaden the query to surface the adjudicating or resolving evidence the current query is missing.",
  };
}

/** Normalize a round's optional fields to the gate's explicit input shape. */
function toGateInput(round: RoundStats): {
  pooledStudies: number;
  totalParticipants: number;
  iSquared: number | null;
  openContradictions: number;
} {
  return {
    pooledStudies: round.k,
    totalParticipants: round.participants,
    iSquared: round.iSquared ?? null,
    openContradictions: round.openContradictions ?? 0,
  };
}

function assembleRoundResult(
  roundNumber: number,
  gate: EvidenceSufficiencyResult,
  decision: RoundDecision,
  reason: string,
  widenAction: WidenAction | null
): RoundResult {
  return {
    round: roundNumber,
    sufficient: gate.sufficient,
    decision,
    reason,
    widenAction,
    criteria: gate.criteria,
  };
}

/**
 * Run the deterministic iterative-research state machine over accrued round stats.
 *
 * For each round (capped at MAX_ROUNDS): run `evidenceSufficiency`; if sufficient, STOP;
 * else if another round remains, CONTINUE with a concrete widen action; else (cap reached
 * or no further round supplied, while still insufficient) STOP honestly with
 * `cap_reached`. Returns the per-round decisions plus the final decision. NO LLM anywhere
 * in the decision path; pure over its inputs (mutates nothing). `opts.maxRounds` lets a
 * caller tighten (never loosen) the cap for testing — it is clamped to MAX_ROUNDS.
 */
export function planIterativeRounds(
  rounds: RoundStats[],
  opts?: { maxRounds?: number }
): IterativePlan {
  const cap = Math.min(
    opts?.maxRounds ?? MAX_ROUNDS,
    MAX_ROUNDS
  );
  const considered = rounds.slice(0, cap);
  const total = considered.length;

  const roundResults: RoundResult[] = [];
  let finalSufficient = false;
  let stopReason: StopReason = "cap_reached";
  let roundsUsed = 0;

  for (let index = 0; index < total; index += 1) {
    const roundNumber = index + 1;
    roundsUsed = roundNumber;
    const isLastSupplied = roundNumber === total;
    const isCap = roundNumber === cap;
    const canContinue = !isLastSupplied && !isCap;

    const gate = evidenceSufficiency(toGateInput(considered[index]));

    if (gate.sufficient) {
      finalSufficient = true;
      stopReason = "sufficient";
      roundResults.push(
        assembleRoundResult(
          roundNumber,
          gate,
          "stop",
          "Evidence is sufficient — all four criteria met; stopping the loop.",
          null
        )
      );
      break;
    }

    if (canContinue) {
      const widenAction = decideWidenAction(gate.criteria);
      const reason = `Insufficient evidence — ${gate.reasons.join(
        " "
      )} Widening retrieval (round ${roundNumber + 1}).`;
      roundResults.push(
        assembleRoundResult(roundNumber, gate, "continue", reason, widenAction)
      );
      continue;
    }

    // Insufficient and no further round permitted (last supplied round or the cap).
    finalSufficient = false;
    stopReason = "cap_reached";
    const reason = isCap
      ? `Round cap (${cap}) reached while still insufficient — ${gate.reasons.join(
          " "
        )} Stopping honestly rather than forcing a low-confidence conclusion.`
      : `No further rounds supplied while still insufficient — ${gate.reasons.join(
          " "
        )} Stopping honestly rather than forcing a low-confidence conclusion.`;
    roundResults.push(
      assembleRoundResult(roundNumber, gate, "stop", reason, null)
    );
    break;
  }

  return {
    rounds: roundResults,
    final: {
      decision: "stop",
      stopReason,
      roundsUsed,
      sufficient: finalSufficient,
    },
    meta: {
      maxRounds: cap,
      roundsSupplied: rounds.length,
    },
  };
}
