// PaperTrail MoA v2 · open_deep_research ITERATIVE sufficiency agent (category "deliberation").
//
// Layer-3 CONSUMER in the composition DAG. It does NOT vote for or against the claim; it
// assesses whether the assembled BODY OF EVIDENCE is adequate to conclude at all — the
// deterministic loop-control half of the deep-research engine (backend/engines/
// open_deep_research/papertrail_iterative.py).
//
// COMPOSITION: it builds ONE RoundStats deterministically from ctx.sources and, crucially,
// COMPOSES on the upstream `effect_sizes` artifact (ParsedEffectSize[]) that the
// quant-extractor enricher PRODUCED earlier — the count of parsed quantitative effects is a
// second signal that the body of evidence is genuinely quantitative, not just a pile of
// prose. That count is folded into the pooled-study proxy `k` alongside the count of sources
// carrying usable text, so a corpus rich in extracted ratio effects clears the study-count
// criterion more readily than an equal number of text-only sources. Participant total is the
// sum of enrollment counts parsed from each source's text (simple, case-insensitive regex).
//
// It then reuses `evidenceSufficiency` from lib/evidencePipeline.ts (which it does NOT edit)
// to score the four field-standard criteria — >=3 studies, >=100 participants, I² < 75%, no
// open contradictions — and PRODUCES a typed `sufficiency` artifact (SufficiencyFinding)
// downstream consumers can read.
//
// VOTE: `insufficient` when the body of evidence is inadequate; `neutral` when adequate —
// never supports/refutes, because this engine weighs adequacy, not direction. Confidence is
// the DOCUMENTED fraction of the four sufficiency criteria that pass.
//
// MOAT preserved: the whole path is DETERMINISTIC — same sources + same effect_sizes in, same
// criteria out. NO LLM: usedClaude is always false. Heterogeneity and open-contradiction
// counts are unknown to a plain claim+sources context, so they are honestly passed as
// null/0 (which fail their criteria) rather than fabricated. No I/O, no DB pool.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  AgentSignal,
  MoaSource,
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
  evidenceSufficiency,
  type EvidenceSufficiencyResult,
} from "../../evidencePipeline";
import {
  planIterativeRounds,
  type RoundStats,
  type WidenAction,
} from "../../research/iterativeLoop";

const AGENT_ID = "iterative";

// Applicable whenever there is at least one source to weigh; it never carries a directional
// vote, so it gates below the verification agents. Zero when no source is present (a widen
// action cannot be derived from an empty context).
const GATE_WITH_SOURCES = 0.5;
const GATE_NO_SOURCES = 0;

// Each passing criterion contributes an equal share of confidence. There are exactly four
// criteria in `evidenceSufficiency`; a fully-adequate body scores 1.0, a fully inadequate
// body scores 0.0. This is the DOCUMENTED confidence function: the fraction of sufficiency
// criteria that pass.
const CRITERIA_COUNT = 4;

// Enrollment-parsing patterns. Deliberately simple and case-insensitive, matching the two
// forms named in the engine spec — "n = 1234" (with optional spaces / thousands separators)
// and "enrolled 1234" / "1234 patients were enrolled". Every match is a non-negative
// integer; nothing is inferred beyond a literal count in the text.
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

// Sum every enrollment count parseable from one source's text. To avoid double-counting the
// same number matched by overlapping patterns, each matched START offset counts once.
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

// How many sources carry usable (non-empty) text — the base pooled-study proxy before the
// consumed effect_sizes signal is folded in.
function usableSourceCount(sources: readonly MoaSource[]): number {
  let count = 0;
  for (const source of sources) {
    if (typeof source.text === "string" && source.text.trim().length > 0) {
      count += 1;
    }
  }
  return count;
}

// How many DISTINCT sources reported at least one parsed quantitative effect in the consumed
// effect_sizes artifact. Counting distinct sources (not raw effect rows) keeps this on the
// same "pooled study" footing as the source count — one source with three effects is still
// one study of quantitative evidence.
function sourcesWithEffects(effects: readonly ParsedEffectSize[]): number {
  const ids = new Set<string>();
  for (const e of effects) ids.add(e.sourceId);
  return ids.size;
}

// The pooled-study proxy `k`: the number of DISTINCT sources that are quantitative-ready —
// i.e. carry usable text OR were shown by the upstream extractor to report a parsed effect
// size. Taking the union means the effect_sizes artifact can only ever RAISE k (never lower
// it below the text-bearing source count), so composing on it strengthens the study-count
// signal without double-counting a source that both has text and an extracted effect.
function pooledStudyProxy(
  sources: readonly MoaSource[],
  effects: readonly ParsedEffectSize[]
): number {
  const quantReady = new Set<string>();
  for (const source of sources) {
    if (typeof source.text === "string" && source.text.trim().length > 0) {
      quantReady.add(source.id);
    }
  }
  for (const e of effects) quantReady.add(e.sourceId);
  return quantReady.size;
}

// Build ONE deterministic round from the context + consumed effect_sizes. `k` is the union
// of text-bearing sources and effect-bearing sources; `participants` is the sum of parsed
// enrollment counts across all sources; heterogeneity and open-contradiction counts are
// unknown to this context, so they are honestly left unknown (iSquared null) / zero.
function buildRound(
  sources: readonly MoaSource[],
  effects: readonly ParsedEffectSize[]
): RoundStats {
  const k = pooledStudyProxy(sources, effects);
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
function signalFromSufficiency(sufficient: boolean): AgentSignal {
  return sufficient ? "neutral" : "insufficient";
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "Iterative Evidence-Sufficiency",
  category: "deliberation",
  description:
    "Deterministic body-of-evidence adequacy assessor: consumes the effect_sizes artifact " +
    "and the retrieved sources, scores them against field-standard sufficiency criteria " +
    "(study count, participants, heterogeneity, contradictions), and produces a sufficiency " +
    "finding saying whether there is enough grounded quantitative evidence to conclude at all.",

  // PRODUCES the sufficiency artifact; CONSUMES the effect_sizes artifact the quant-extractor
  // enricher writes in Layer 1 (so the scheduler runs this agent AFTER that producer).
  produces: ["sufficiency"] as const,
  consumes: ["effect_sizes"] as const,

  // ELIGIBILITY, deterministic from the input alone (never the blackboard): applicable
  // whenever at least one usable source exists — with sources, the extractor may produce
  // effect_sizes for this agent to fold into k, and there is a body of evidence to assess.
  // Pure and side-effect-free; never throws.
  gate(ctx: OrchestrationContext): number {
    return usableSourceCount(ctx.sources) >= 1 ? GATE_WITH_SOURCES : GATE_NO_SOURCES;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    // Honest skip: no usable source text means no body of evidence to assess.
    if (usableSourceCount(ctx.sources) < 1) {
      return skippedContribution(
        AGENT_ID,
        "No usable source text — cannot assess evidence sufficiency."
      );
    }

    try {
      // COMPOSE: read the upstream effect_sizes artifact. Its absence is not fatal — the
      // assessor degrades honestly to the text-only source count for `k` — but when present,
      // the count of distinct effect-bearing sources strengthens the study-count signal.
      const effects = bb.get("effect_sizes") ?? [];
      const effectSourceCount = sourcesWithEffects(effects);

      const round = buildRound(ctx.sources, effects);

      // Score the single accrued round. planIterativeRounds reuses evidenceSufficiency
      // internally and yields the loop's stop reason + one concrete widen action when the
      // body of evidence is still inadequate — surfaced here for the detail panel.
      const gate = evidenceSufficiency({
        pooledStudies: round.k,
        totalParticipants: round.participants,
        iSquared: round.iSquared ?? null,
        openContradictions: round.openContradictions ?? 0,
      });
      const plan = planIterativeRounds([round]);
      const widenAction: WidenAction | null = plan.rounds[0]?.widenAction ?? null;

      const passed = passingCriteria(gate.criteria);
      // Documented confidence: fraction of the four sufficiency criteria that pass.
      const confidence = clamp01(passed / CRITERIA_COUNT);
      const signal = signalFromSufficiency(gate.sufficient);

      // The typed artifact this agent PRODUCES for downstream consumers.
      const sufficiency: SufficiencyFinding = {
        sufficient: gate.sufficient,
        reasons: gate.reasons,
        k: round.k,
        participants: round.participants,
      };

      const summary = gate.sufficient
        ? `Evidence is sufficient to conclude — all ${CRITERIA_COUNT} criteria met across ${round.k} quantitative-ready source(s), ${round.participants} participants.`
        : `Evidence is insufficient to conclude — ${passed}/${CRITERIA_COUNT} criteria met across ${round.k} quantitative-ready source(s), ${round.participants} participants.`;

      return makeContribution(AGENT_ID, {
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
          consumedEffectSizes: effects.length,
          effectBearingSources: effectSourceCount,
          textBearingSources: usableSourceCount(ctx.sources),
          producerOfEffectSizes: bb.producerOf("effect_sizes") ?? null,
          stopReason: plan.final.stopReason,
          widenAction: widenAction
            ? { type: widenAction.type, detail: widenAction.detail }
            : null,
        },
        // No grounded spans: this engine weighs counts, not verbatim quotes.
        groundedSpans: [],
        usedClaude: false,
        produced: { sufficiency },
      });
    } catch (err) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
