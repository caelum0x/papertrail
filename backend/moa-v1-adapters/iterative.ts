// ITERATIVE expert — evidence-sufficiency assessor (open_deep_research adapter).
//
// Wraps the deterministic deep-research loop-control engine: it does NOT vote for or
// against the claim, it assesses whether the assembled BODY OF EVIDENCE is adequate to
// conclude at all. It builds ONE RoundStats deterministically from ctx.sources (source
// count as the pooled-study proxy k, plus a participant total parsed from the source
// text via a simple enrollment regex), then reuses `evidenceSufficiency` from
// lib/evidencePipeline.ts (which it does NOT edit) to score the four field-standard
// criteria — >=3 studies, >=100 participants, I² < 75%, no open contradictions.
//
// MOAT preserved: the whole path is DETERMINISTIC — same sources in, same criteria out.
// NO LLM: usedClaude is always false. Heterogeneity and open-contradiction counts are
// unknown to a plain claim+sources context, so they are honestly passed as 0/unknown
// (which fail their criteria) rather than fabricated. Signal is `insufficient` when the
// body of evidence is inadequate and `neutral` when it is adequate — never supports /
// refutes, because this engine weighs adequacy, not direction.

import type {
  Expert,
  OrchestrationContext,
  ExpertContribution,
  ExpertSignal,
  MoaSource,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import {
  evidenceSufficiency,
  type EvidenceSufficiencyResult,
} from "../../evidencePipeline";
import {
  planIterativeRounds,
  type RoundStats,
  type WidenAction,
} from "../../research/iterativeLoop";

const EXPERT_ID = "iterative";

// Moderate relevance: this assessor is applicable whenever there is at least one source
// to weigh, but it never carries a directional vote, so it gates below the verification
// experts. Below-threshold-but-nonzero (planner may boost) when no source is present.
const GATE_WITH_SOURCES = 0.5;
const GATE_NO_SOURCES = 0;

// Each passing criterion contributes an equal share of confidence. There are exactly
// four criteria in `evidenceSufficiency`; a fully-adequate body scores 1.0, a fully
// inadequate body scores 0.0. This is the DOCUMENTED confidence function: the fraction
// of sufficiency criteria that pass.
const CRITERIA_COUNT = 4;

// Enrollment-parsing patterns. Deliberately simple and case-insensitive, matching the
// two forms named in the engine spec — "n = 1234" (with optional spaces / thousands
// separators) and "enrolled 1234" / "1234 patients were enrolled". Every match is a
// non-negative integer; nothing is inferred beyond a literal count in the text.
const ENROLLMENT_PATTERNS: readonly RegExp[] = [
  /\bn\s*=\s*([\d,]{1,9})\b/gi,
  /\benrolled\s+([\d,]{1,9})\b/gi,
  /\b([\d,]{1,9})\s+(?:patients|participants|subjects)\s+(?:were\s+)?enrolled\b/gi,
];

// Parse a single "1,234" style integer token into a number, dropping thousands commas.
// Returns null for anything that is not a clean non-negative integer.
function parseCount(token: string): number | null {
  const digits = token.replace(/,/g, "");
  if (digits.length === 0) return null;
  const value = Number.parseInt(digits, 10);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

// Sum every enrollment count parseable from one source's text. To avoid double-counting
// the same number matched by overlapping patterns, each matched START offset counts once.
function participantsInText(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  const seenAt = new Set<number>();
  let total = 0;
  for (const pattern of ENROLLMENT_PATTERNS) {
    // Fresh lastIndex per source; the /g flag makes exec iterate all matches.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match !== null) {
      const captured = match[1];
      if (captured !== undefined && !seenAt.has(match.index)) {
        const count = parseCount(captured);
        if (count !== null) {
          total += count;
          seenAt.add(match.index);
        }
      }
      match = pattern.exec(text);
    }
  }
  return total;
}

// How many sources carry usable (non-empty) text — the pooled-study proxy `k`.
function usableSourceCount(sources: readonly MoaSource[]): number {
  let count = 0;
  for (const source of sources) {
    if (typeof source.text === "string" && source.text.trim().length > 0) {
      count += 1;
    }
  }
  return count;
}

// Build ONE deterministic round from the context. `k` = usable source count;
// `participants` = sum of parsed enrollment counts across all sources; heterogeneity and
// open-contradiction counts are unknown to this context, so they are honestly left
// unknown (iSquared null) / zero rather than invented.
function buildRound(sources: readonly MoaSource[]): RoundStats {
  const k = usableSourceCount(sources);
  let participants = 0;
  for (const source of sources) {
    participants += participantsInText(source.text);
  }
  return {
    k,
    participants,
    iSquared: null,
    openContradictions: 0,
  };
}

// Count how many of the four sufficiency criteria pass — the confidence numerator.
function passingCriteria(
  criteria: EvidenceSufficiencyResult["criteria"]
): number {
  let passed = 0;
  if (criteria.enoughStudies) passed += 1;
  if (criteria.enoughParticipants) passed += 1;
  if (criteria.acceptableHeterogeneity) passed += 1;
  if (criteria.contradictionsResolved) passed += 1;
  return passed;
}

// The engine's contribution is a WEIGHTING read on body-of-evidence adequacy, not a
// direction: `insufficient` when inadequate, `neutral` when adequate.
function signalFromSufficiency(sufficient: boolean): ExpertSignal {
  return sufficient ? "neutral" : "insufficient";
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "Iterative Evidence-Sufficiency",
  category: "meta",
  description:
    "Deterministic body-of-evidence adequacy assessor: scores the retrieved sources " +
    "against field-standard sufficiency criteria (study count, participants, " +
    "heterogeneity, contradictions) to say whether there is enough to conclude at all.",

  gate(ctx: OrchestrationContext): number {
    // Applicable whenever at least one usable source exists; otherwise there is
    // nothing to assess (a widen action cannot be derived from an empty context).
    return usableSourceCount(ctx.sources) >= 1
      ? GATE_WITH_SOURCES
      : GATE_NO_SOURCES;
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    // Honest skip: no usable source text means no body of evidence to assess.
    if (usableSourceCount(ctx.sources) < 1) {
      return skippedContribution(
        EXPERT_ID,
        "No usable source text — cannot assess evidence sufficiency."
      );
    }

    try {
      const round = buildRound(ctx.sources);

      // Score the single accrued round. planIterativeRounds reuses evidenceSufficiency
      // internally and yields the loop's stop reason + one concrete widen action when
      // the body of evidence is still inadequate — surfaced here for the detail panel.
      const gate = evidenceSufficiency({
        pooledStudies: round.k,
        totalParticipants: round.participants,
        iSquared: round.iSquared ?? null,
        openContradictions: round.openContradictions ?? 0,
      });
      const plan = planIterativeRounds([round]);
      const widenAction: WidenAction | null =
        plan.rounds[0]?.widenAction ?? null;

      const passed = passingCriteria(gate.criteria);
      // Documented confidence: fraction of the four sufficiency criteria that pass.
      const confidence = clamp01(passed / CRITERIA_COUNT);
      const signal = signalFromSufficiency(gate.sufficient);

      const summary = gate.sufficient
        ? `Evidence is sufficient to conclude — all ${CRITERIA_COUNT} criteria met across ${round.k} source(s), ${round.participants} participants.`
        : `Evidence is insufficient to conclude — ${passed}/${CRITERIA_COUNT} criteria met across ${round.k} source(s), ${round.participants} participants.`;

      return makeContribution(EXPERT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          sufficient: gate.sufficient,
          criteria: gate.criteria,
          criteriaPassed: passed,
          criteriaTotal: CRITERIA_COUNT,
          reasons: gate.reasons,
          round: {
            k: round.k,
            participants: round.participants,
            iSquared: round.iSquared,
            openContradictions: round.openContradictions,
          },
          stopReason: plan.final.stopReason,
          widenAction: widenAction
            ? { type: widenAction.type, detail: widenAction.detail }
            : null,
        },
        // No grounded spans: this engine weighs counts, not verbatim quotes.
        groundedSpans: [],
        usedClaude: false,
      });
    } catch (err: unknown) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
