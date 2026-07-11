// PaperTrail MoA v2 — AUTOLOOP evidence-refinement agent (category: deliberation).
//
// COMPOSITION ROLE (LAYER 3 · DELIBERATION): autoloop does NOT retrieve, classify, or pool
// anything itself. It CONSUMES two upstream artifacts and builds a bounded refinement loop ON
// them:
//   - `sufficiency` (SufficiencyFinding) produced by the deep-research sufficiency assessor
//      (open_deep_research / iterative) — the body-of-evidence adequacy read: {sufficient,
//      reasons, k, participants}.
//   - `effect_sizes` (ParsedEffectSize[]) produced by the quant-extractor enricher — the parsed
//      ratio effects (RR/HR/OR) per source; autoloop reads their DIRECTIONS to detect an open
//      contradiction (studies pointing opposite ways) that a raw sufficiency count cannot see.
//
// It productionizes karpathy/autoresearch's propose -> evaluate -> keep/discard bounded loop,
// adapted from GPU-training search to EVIDENCE refinement: given the current sufficiency + effect
// stats, it deterministically PROPOSES the next refinement action (raise the retrieval limit /
// add a facet / broaden the query) and DECIDES continue|stop under a hard round cap. There is NO
// training, NO GPU, NO network — only evidence logic.
//
// It VOTES neutral when the loop is stop-worthy (the accrued evidence is adequate to conclude and
// no further refinement is warranted) and `mixed` when the loop says "need more evidence" (the
// refinement machine still wants another bounded pass; the body is not settled). It never votes
// supports/refutes — autoloop weighs whether we have ENOUGH to conclude, not the direction. The
// `mixed` (rather than `insufficient`) vote is deliberate: only VOTES = {supports, refutes, mixed}
// are tallied by the aggregator, so a `mixed` vote actually DILUTES an over-confident high-
// agreement verdict, whereas `insufficient` would be silently ignored (see signalFromLoop, FIX 1).
//
// PRODUCES: [] — a terminal deliberation voter; it writes no artifact.
// CONSUMES: ["sufficiency", "effect_sizes"] — the scheduler orders autoloop AFTER the sufficiency
//   assessor and the effect-size extractor. If `sufficiency` is absent at run time there is no
//   accrued body of evidence to refine, so it degrades honestly (skippedContribution); if only
//   `effect_sizes` is absent it still runs on sufficiency alone (0 open contradictions), lower
//   information but honest.
//
// MOAT: the continue/stop decision and the proposed next step are pure deterministic threshold
// math — they run through lib/research/iterativeLoop.planIterativeRounds (which reuses the
// field-standard evidenceSufficiency gate), never an LLM. usedClaude is always false. No DB pool,
// no network, no GPU, no training. The Python mirror is
// backend/engines/autoresearch-karpathy/papertrail_loop.py.
//
// This is a NEW v2 agent (no v1 adapter existed): it composes the sufficiency artifact + the
// effect-size directions into the bounded refinement loop and votes on the loop's stop decision.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  AgentSignal,
  ParsedEffectSize,
  SufficiencyFinding,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import {
  planIterativeRounds,
  MAX_ROUNDS,
  type RoundStats,
  type WidenAction,
} from "../../research/iterativeLoop";

const AGENT_ID = "autoloop";

// Eligibility weight when the input carries at least one source. Deliberation refinement is a
// context-organizer (what to do next), not a directional vote, so it gates modestly per spec.
const GATE_ELIGIBLE = 0.4;

// The null value shared by every ratio measure: ratio == 1 <=> no effect. A pooled body with
// some ratios below 1 (benefit) and some above 1 (harm) is an OPEN CONTRADICTION the raw
// sufficiency count cannot detect — autoloop surfaces it from the consumed effect directions.
const NULL_RATIO = 1;

// A directional disagreement across the consumed effects counts as ONE open contradiction for
// the sufficiency gate — enough to fail the "contradictions resolved" criterion and drive the
// loop to propose a broaden_query pass. We never fabricate a larger count than the evidence
// supports: it is 0 (no disagreement) or 1 (at least one benefit and one harm effect).
const CONTRADICTION_PRESENT = 1;
const NO_CONTRADICTION = 0;

// Count how many consumed effects point each way relative to the null of 1. Point estimates
// exactly at the null (ratio == 1, no effect) are neither, so they are ignored. Deterministic.
function countDirections(effects: readonly ParsedEffectSize[]): {
  benefit: number;
  harm: number;
} {
  let benefit = 0;
  let harm = 0;
  for (const e of effects) {
    if (e.point < NULL_RATIO) benefit += 1;
    else if (e.point > NULL_RATIO) harm += 1;
  }
  return { benefit, harm };
}

// An open contradiction exists when the consumed effects disagree in direction — at least one
// beneficial (ratio < 1) AND at least one harmful (ratio > 1) effect in the same body. When the
// effect_sizes artifact is absent/empty we honestly report 0 (no basis to assert a conflict).
function openContradictionsFrom(effects: readonly ParsedEffectSize[]): number {
  if (effects.length === 0) return NO_CONTRADICTION;
  const { benefit, harm } = countDirections(effects);
  return benefit > 0 && harm > 0 ? CONTRADICTION_PRESENT : NO_CONTRADICTION;
}

// FIX 3 + FIX 4 (additive detail, non-gating): the loop's openContradictions is deliberately
// a binary 0/1 gate signal (present/absent) — that is the deterministic criterion the field-
// standard sufficiency gate consumes and MUST stay stable. But a raw 0/1 loses the SEVERITY of
// disagreement (Fix 3: a 5-vs-5 split reads the same as 1-vs-1) and its DILUTION by null-effect
// saturation (Fix 4: a 1-vs-1 split inside 100 null effects is a far weaker signal than inside 2).
// We expose both as pure, deterministic diagnostics on `detail` so upstream/UI can judge how
// contested the body really is — WITHOUT altering the binary gate feeding the loop or any vote.
interface ContradictionSeverity {
  // How many effects point each way relative to the null of 1.
  benefit: number;
  harm: number;
  // Effects with a non-null direction (benefit + harm); the rest sit exactly at ratio == 1.
  directional: number;
  // directional / total effects: what fraction of the body carries ANY directional signal.
  // Low saturation => a directional split is a weak, easily-over-read contradiction.
  saturation: number;
  // harm / directional: 0 = all benefit, 1 = all harm, 0.5 = an evenly contested split.
  // Undefined direction (no directional effects) collapses to 0 by construction.
  disagreementRatio: number;
  // A balance-and-saturation-weighted severity in [0,1]: peaks at an evenly-split, fully-
  // directional body and decays toward 0 as one side dominates OR null effects saturate the pool.
  // Diagnostic only — it moves nothing in the numeric/verdict path.
  weightedSeverity: number;
}

function contradictionSeverityFrom(
  effects: readonly ParsedEffectSize[]
): ContradictionSeverity {
  const { benefit, harm } = countDirections(effects);
  const directional = benefit + harm;
  const total = effects.length;
  const saturation = total > 0 ? directional / total : 0;
  const disagreementRatio = directional > 0 ? harm / directional : 0;
  // Balance term (Fix 4 option B shape): 1 when perfectly split, -> 0 as one side dominates.
  const balance =
    directional > 0 ? 1 - Math.abs(benefit - harm) / directional : 0;
  const contested = benefit > 0 && harm > 0 ? 1 : 0;
  const weightedSeverity = clamp01(contested * balance * saturation);
  return {
    benefit,
    harm,
    directional,
    saturation: round4(saturation),
    disagreementRatio: round4(disagreementRatio),
    weightedSeverity: round4(weightedSeverity),
  };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// FIX 2: a fractional sufficiency.k (an intentional weighted count like 2.9) was silently
// FLOORED by Math.trunc — turning 2.9 into 2, failing enoughStudies (2 < 3), and over-pessimising
// the loop into voting insufficient. We now Math.round to the NEAREST integer (2.9 -> 3, 2.4 ->
// 2), which respects a weighted count without inventing evidence, and we surface a truncationNote
// whenever the integerised value differs from the raw input so downstream sees the discrepancy
// between detail.round.k and detail.consumedSufficiency.k rather than a silent mismatch.
function integerise(raw: number): number {
  return Math.max(0, Math.round(raw));
}

function roundingNote(rawK: number, roundedK: number): string | null {
  if (rawK === roundedK) return null;
  return `studies count rounded from ${rawK} to ${roundedK} (nearest integer) for the sufficiency gate`;
}

// Build the single accrued RoundStats the refinement loop evaluates, COMPOSING both consumed
// artifacts: k + participants come from the sufficiency assessor's finding; openContradictions
// is derived from the effect-size directions. Heterogeneity (I²) is not knowable from these two
// artifacts, so it is honestly left null (which fails its criterion) rather than invented.
function buildRound(
  sufficiency: SufficiencyFinding,
  effects: readonly ParsedEffectSize[]
): RoundStats {
  return {
    k: integerise(sufficiency.k),
    participants: integerise(sufficiency.participants),
    iSquared: null,
    openContradictions: openContradictionsFrom(effects),
  };
}

// FIX 1 [wrong_verdict]: the aggregator only tallies VOTES = {supports, refutes, mixed}
// (aggregate.ts:50,110). `insufficient` is NOT a counted vote, so an AutoLoop `insufficient`
// signal was invisible to the verdict — letting the mixture return "supported" at high trust
// even when this agent had explicitly judged the body of evidence inadequate to conclude. The
// architectural veto (Option A: make aggregate downweight on `insufficient`) lives in a DIFFERENT
// file we must not touch and would alter the public mix, so we take the moat-safe Option B: when
// the loop is NOT stop-worthy, cast the COUNTED `mixed` vote. `mixed` is deliberation's honest
// "the evidence is not settled" signal — it dilutes an otherwise high-agreement tally (raising the
// contest/mixed ratios in aggregate.ts) instead of silently abstaining. This changes NO numeric
// path (aggregate math is untouched; the vote is just now visible) and keeps usedClaude false.
//
//   stop-worthy & sufficient -> neutral (enough to conclude; abstain, no refinement needed)
//   not stop-worthy          -> mixed   (evidence inadequate/unsettled; dilute the verdict)
function signalFromLoop(sufficient: boolean): AgentSignal {
  return sufficient ? "neutral" : "mixed";
}

// There are exactly four sufficiency criteria; a fully-adequate body passes all four.
const CRITERIA_COUNT = 4;

type SufficiencyCriteria = {
  enoughStudies: boolean;
  enoughParticipants: boolean;
  acceptableHeterogeneity: boolean;
  contradictionsResolved: boolean;
};

// Count how many of the four sufficiency criteria pass — the confidence numerator.
function countPassing(criteria: SufficiencyCriteria): number {
  let passed = 0;
  if (criteria.enoughStudies) passed += 1;
  if (criteria.enoughParticipants) passed += 1;
  if (criteria.acceptableHeterogeneity) passed += 1;
  if (criteria.contradictionsResolved) passed += 1;
  return passed;
}

// Derive the next bounded refinement step from the FAILING criteria by the same fixed priority
// the iterative loop uses (raise_limit / add_facet / broaden_query). Called only when the loop is
// NOT stop-worthy, so at least one criterion is failing. Deterministic; mirrors decideWidenAction.
function deriveNextStep(criteria: SufficiencyCriteria): WidenAction {
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
  return {
    type: "broaden_query",
    detail:
      "Open contradictions between sources — broaden the query to surface the adjudicating or resolving evidence the current query is missing.",
  };
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "AutoLoop Evidence Refinement",
  category: "deliberation",
  description:
    "Deliberation: consumes the deep-research sufficiency finding and the parsed effect sizes, " +
    "then runs karpathy/autoresearch's bounded propose-evaluate-keep loop adapted to evidence " +
    "refinement — deterministically proposing the next refinement step (raise limit / add facet " +
    "/ broaden query) and deciding continue|stop under a hard round cap. No LLM, no training.",

  // Terminal deliberation voter: produces no artifact.
  produces: [] as const,
  // Composition: reads the sufficiency assessor's finding (the accrued body of evidence) and the
  // quant-extractor's effect sizes (for a directional-contradiction signal). Scheduler orders
  // autoloop AFTER both producers.
  consumes: ["sufficiency", "effect_sizes"] as const,

  // ELIGIBILITY: pure + deterministic over the INPUT only (never the blackboard). Eligible at
  // GATE_ELIGIBLE when >= 1 source exists (so an upstream sufficiency finding can plausibly be
  // produced to refine); otherwise 0. No I/O, no LLM, never throws.
  gate(ctx: OrchestrationContext): number {
    return ctx.sources.length >= 1 ? GATE_ELIGIBLE : 0;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    try {
      // COMPOSE: the load-bearing dependency is the sufficiency finding — without it there is no
      // accrued body of evidence to refine, so degrade honestly rather than guess.
      const sufficiency = bb.get("sufficiency");
      if (sufficiency === undefined) {
        return skippedContribution(
          AGENT_ID,
          "No sufficiency artifact was produced upstream (the deep-research assessor did not run) — nothing to refine."
        );
      }

      // Optional composition input: the parsed effect sizes give a directional-contradiction
      // signal the raw sufficiency count cannot. Absent/empty -> 0 open contradictions (honest).
      const effects = bb.get("effect_sizes") ?? [];

      // Build the single accrued round from BOTH consumed artifacts and run the bounded loop.
      const round = buildRound(sufficiency, effects);
      const plan = planIterativeRounds([round]);

      // The proposed next refinement step. On a single round the machine can only stop (it is the
      // last supplied round), so no widenAction is emitted on the round record; we derive the
      // action that WOULD be taken next from the same deterministic priority when insufficient.
      const roundRecord = plan.rounds[0];
      const criteria = roundRecord?.criteria ?? {
        enoughStudies: false,
        enoughParticipants: false,
        acceptableHeterogeneity: false,
        contradictionsResolved: false,
      };
      const stop = plan.final.sufficient;
      const proposedNextStep: WidenAction | null = stop
        ? null
        : deriveNextStep(criteria);

      const signal = signalFromLoop(stop);

      // Documented confidence: the fraction of the four sufficiency criteria that pass. A
      // fully-adequate body (stop-worthy) scores 1.0; a fully-inadequate body scores 0.0. This is
      // the deterministic loop's own read, never an LLM's.
      const passed = countPassing(criteria);
      const confidence = clamp01(passed / CRITERIA_COUNT);

      const { benefit, harm } = countDirections(effects);

      // FIX 3 + FIX 4 diagnostics: severity + saturation of any directional disagreement.
      const contradictionSeverity = contradictionSeverityFrom(effects);

      // FIX 2 diagnostics: surface any rounding the sufficiency gate applied to k / participants
      // so detail.round.* and detail.consumedSufficiency.* discrepancies are explained, not silent.
      const truncationNotes = [
        roundingNote(sufficiency.k, round.k),
        roundingNote(sufficiency.participants, round.participants),
      ].filter((note): note is string => note !== null);

      const summary = stop
        ? `AutoLoop: evidence is stop-worthy — all sufficiency criteria met across ${round.k} pooled ${round.k === 1 ? "study" : "studies"}, ${round.participants} participants; no further refinement proposed.`
        : `AutoLoop: needs more evidence — ${passed}/${CRITERIA_COUNT} criteria met; next refinement step "${proposedNextStep?.type ?? "raise_limit"}".`;

      return makeContribution(AGENT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          // The three fields the spec pins to detail.
          proposedNextStep: proposedNextStep
            ? { type: proposedNextStep.type, detail: proposedNextStep.detail }
            : null,
          stop,
          roundsCap: MAX_ROUNDS,
          // Composition provenance + the numbers the loop evaluated.
          criteria,
          criteriaPassed: passed,
          criteriaTotal: CRITERIA_COUNT,
          stopReason: plan.final.stopReason,
          round: {
            k: round.k,
            participants: round.participants,
            iSquared: round.iSquared,
            openContradictions: round.openContradictions,
          },
          consumedSufficiency: {
            sufficient: sufficiency.sufficient,
            k: sufficiency.k,
            participants: sufficiency.participants,
            reasons: sufficiency.reasons,
          },
          consumedEffectCount: effects.length,
          effectDirections: { benefit, harm },
          // FIX 3 + FIX 4: severity + null-effect-saturation of the directional disagreement,
          // exposed for upstream/UI WITHOUT changing the binary openContradictions gate above.
          contradictionSeverity,
          // FIX 2: any nearest-integer rounding the sufficiency gate applied to k / participants.
          // Empty when round.* exactly matches consumedSufficiency.* (no rounding occurred).
          truncationNotes,
          sufficiencyProducer: bb.producerOf("sufficiency") ?? null,
          effectSizesProducer: bb.producerOf("effect_sizes") ?? null,
        },
        // No grounded spans: autoloop weighs counts + directions, not verbatim quotes.
        groundedSpans: [],
        usedClaude: false,
        produced: {},
      });
    } catch (err) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
