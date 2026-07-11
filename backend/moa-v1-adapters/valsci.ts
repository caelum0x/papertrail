// PaperTrail MoA expert — Valsci quantitative CONTRADICTION ATLAS.
//
// This adapter wraps lib/contradiction/atlas resolveContradiction: score the whole set
// with the deterministic Valsci port, partition the grounded sources into supporting /
// refuting sides by the sign of their support, then attribute any reversal to a
// study-design dimension (population / dose / tissue / follow_up) with DETERMINISTIC
// rules. It answers "these sources disagree — WHY?".
//
// Engine boundary honored:
//   - resolveContradiction is stateless here: we pass the Claude source-scorer + feature
//     tagger the production route uses, and OMIT the mechanism dep (that path needs a DB
//     pool / persistence; the atlas degrades to belief 0 exactly like the route does).
//   - Both learned steps (per-source support scoring, per-source feature tagging) run
//     Claude. They are gated behind ctx.options.llm: when llm is false we cannot supply a
//     deterministic scorer without inventing scores, so we gate low and skip honestly.
//   - Every surfaced quote is a verbatim span the atlas already grounded (Valsci support
//     spans + grounded design-feature quotes) — never fabricated here.
//   - The signal/confidence come from the atlas' deterministic resolution, not from Claude.

import type { Expert, OrchestrationContext, ExpertContribution, GroundedSpan } from "../types";
import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";
import {
  resolveContradiction,
  claudeFeatureTagger,
  type ResolveInput,
} from "../../contradiction/atlas";
import { claudeSourceScorer } from "../../scieval/valsci";
import type {
  ContradictionSourceInput,
  ContradictionAtlasResult,
  SourceVerdict,
} from "../../contradiction/schemas";

const ID = "valsci";

// The atlas needs at least two sources to have two sides at all.
const MIN_SOURCES = 2;

// Minimum source body length the atlas request schema accepts (schemas.ts: raw_text min 40).
const MIN_SOURCE_CHARS = 40;

// How many grounded spans (support spans + differing-feature quotes) to surface, capped so
// the contribution stays small for the detail panel.
const MAX_SPANS = 8;

// Lexical cues that a set plausibly DISAGREES on direction — a reduction claim alongside a
// no-effect / null / increase reading. Deterministic, no I/O; only nudges the gate up.
const REDUCTION_CUES = [
  "reduc",
  "lower",
  "decreas",
  "decline",
  "improv",
  "protect",
  "benefit",
  "effica",
];
const NULL_OR_OPPOSITE_CUES = [
  "no effect",
  "no significant",
  "not significant",
  "no difference",
  "no benefit",
  "null",
  "ineffective",
  "failed to",
  "did not",
  "increas",
  "worsen",
  "harm",
  "adverse",
];

function hasAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// A cheap deterministic label read for gating only (NOT a verdict). "reduction" if the text
// leans toward an effect, "null_or_opposite" if it leans against, "unknown" otherwise.
type Lean = "reduction" | "null_or_opposite" | "unknown";

function leanOf(text: string): Lean {
  const t = text.toLowerCase();
  const pos = hasAny(t, REDUCTION_CUES);
  const neg = hasAny(t, NULL_OR_OPPOSITE_CUES);
  if (neg) return "null_or_opposite";
  if (pos) return "reduction";
  return "unknown";
}

// Deterministic relevance: the atlas is a two-sided disagreement resolver. It gates HIGH
// only when there are >=2 usable sources AND there is plausible disagreement — either the
// sources carry conflicting upstream labels, or their text leans in opposite directions
// (some read as a reduction, some as a null / opposite). Otherwise MODERATE (a set of >=2
// sources could still hide a latent conflict Valsci surfaces, but we shouldn't over-gate).
//
// If Claude is disabled the two learned steps cannot run statelessly, so gate LOW — the
// engine fundamentally cannot contribute without its scorer.
function gate(ctx: OrchestrationContext): number {
  if (!ctx.options.llm) return 0.05;

  const usable = ctx.sources.filter((s) => s.text.trim().length >= MIN_SOURCE_CHARS);
  if (usable.length < MIN_SOURCES) return 0.05;

  // Signal 1: conflicting upstream labels (some SUPPORTS, some REFUTES) — an explicit disagreement.
  const labels = new Set(
    usable.map((s) => s.label).filter((l): l is NonNullable<typeof l> => l !== undefined)
  );
  const conflictingLabels = labels.has("SUPPORTS") && labels.has("REFUTES");

  // Signal 2: opposing directional leans in the source text (a reduction AND a null/opposite present).
  let sawReduction = false;
  let sawOpposite = false;
  for (const s of usable) {
    const lean = leanOf(s.text);
    if (lean === "reduction") sawReduction = true;
    else if (lean === "null_or_opposite") sawOpposite = true;
  }
  // The claim's own lean, paired with a source that leans the other way, is also a disagreement.
  const claimLean = leanOf(ctx.claim);
  const claimVsSource =
    (claimLean === "reduction" && sawOpposite) ||
    (claimLean === "null_or_opposite" && sawReduction);

  const plausibleDisagreement =
    conflictingLabels || (sawReduction && sawOpposite) || claimVsSource;

  return plausibleDisagreement ? 0.8 : 0.3;
}

// Confidence from the atlas' deterministic resolution strength.
//   attributed_reversal   -> primary_hypothesis.strength (the winning dimension's strength)
//   unattributed_conflict -> a modest floor: two real sides exist but no clean attribution
//   no_conflict           -> low: sides don't straddle, little for this expert to add
//   insufficient          -> 0
function confidenceOf(result: ContradictionAtlasResult): number {
  switch (result.resolution_category) {
    case "attributed_reversal":
      return clamp01(result.primary_hypothesis?.strength ?? 0.35);
    case "unattributed_conflict":
      return 0.3;
    case "no_conflict":
      return 0.1;
    case "insufficient":
      return 0;
  }
}

// Map the atlas resolution onto a MoA signal.
//   A resolved contradiction (both sides present) is the engine's core contribution: "mixed".
//   no_conflict  -> neutral (the atlas found no two-sided disagreement to weigh in on).
//   insufficient -> insufficient (too few grounded, directional sources).
function signalOf(result: ContradictionAtlasResult): ExpertContribution["signal"] {
  switch (result.resolution_category) {
    case "attributed_reversal":
    case "unattributed_conflict":
      return "mixed";
    case "no_conflict":
      return "neutral";
    case "insufficient":
      return "insufficient";
  }
}

// Collect verbatim, already-grounded spans: each side's Valsci support span, then the
// differing-feature quotes for the attributed dimension. Every span text is a substring the
// atlas grounded (Valsci support span or locateSpan'd feature quote) — never re-derived here.
function collectSpans(result: ContradictionAtlasResult): GroundedSpan[] {
  const spans: GroundedSpan[] = [];
  const seen = new Set<string>();

  const pushVerdictSpan = (v: SourceVerdict): void => {
    const text = v.span.text;
    if (text.trim().length === 0) return;
    const key = `${v.source_type}:${v.external_id}:${v.span.grounding.start}:${v.span.grounding.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    spans.push({
      sourceId: v.external_id,
      text,
      start: v.span.grounding.start,
      end: v.span.grounding.end,
    });
  };

  for (const v of result.supporting) pushVerdictSpan(v);
  for (const v of result.refuting) pushVerdictSpan(v);

  // Add the winning dimension's grounded feature quotes (both sides) when attributed.
  if (result.primary_hypothesis) {
    const dim = result.primary_hypothesis.dimension;
    const attribution = result.attributions.find((a) => a.dimension === dim);
    if (attribution) {
      const quotes = [...attribution.supporting_quotes, ...attribution.refuting_quotes];
      for (const q of quotes) {
        const key = `feat:${dim}:${q.grounding.start}:${q.grounding.end}:${q.quote}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // The atlas does not carry the source id on a GroundedFeature; label by dimension so
        // the panel can attribute it to the winning axis without fabricating a source id.
        spans.push({
          sourceId: `dimension:${dim}`,
          text: q.quote,
          start: q.grounding.start,
          end: q.grounding.end,
        });
      }
    }
  }

  return spans.slice(0, MAX_SPANS);
}

function summarize(result: ContradictionAtlasResult): string {
  const s = result.supporting_count;
  const r = result.refuting_count;
  switch (result.resolution_category) {
    case "attributed_reversal": {
      const dim = result.primary_hypothesis?.dimension ?? "a design dimension";
      return `Sources disagree (${s} supporting vs ${r} refuting); the reversal is attributed to ${dim}.`;
    }
    case "unattributed_conflict":
      return `Sources disagree (${s} supporting vs ${r} refuting) but no single design dimension cleanly explains the reversal.`;
    case "no_conflict":
      return `No two-sided disagreement: the grounded sources do not straddle both sides.`;
    case "insufficient":
      return `Too few grounded, directional sources to resolve a contradiction.`;
  }
}

async function run(ctx: OrchestrationContext): Promise<ExpertContribution> {
  // Honest stateless skip: the atlas' two learned steps (support scoring + feature tagging)
  // require Claude; we cannot supply deterministic substitutes without inventing scores.
  if (!ctx.options.llm) {
    return skippedContribution(
      ID,
      "Valsci contradiction atlas needs Claude for source scoring + feature tagging; skipped in deterministic-only mode."
    );
  }

  const usable = ctx.sources.filter((s) => s.text.trim().length >= MIN_SOURCE_CHARS);
  if (usable.length < MIN_SOURCES) {
    return skippedContribution(
      ID,
      "Needs at least two sources with extractable text to look for a contradiction."
    );
  }

  try {
    // Map MoA sources onto the atlas' ContradictionSourceInput shape. external_id must be
    // unique per source for the atlas' (source_type, external_id) index; the MoA source id is.
    const sources: ContradictionSourceInput[] = usable.map((s) => ({
      source_type: s.isPreprint ? "preprint" : "abstract",
      external_id: s.id,
      raw_text: s.text,
      title: s.title ?? null,
      url: s.url ?? null,
    }));

    const input: ResolveInput = { claim: ctx.claim, sources };

    // Pass the production Claude scorer + tagger; OMIT mechanism (needs persistence / a DB
    // pool). The atlas degrades to mechanism belief 0 — identical to the /api route.
    const result = await resolveContradiction(input, {
      score: { scoreSource: claudeSourceScorer },
      tagFeatures: claudeFeatureTagger,
    });

    return makeContribution(ID, {
      ran: true,
      signal: signalOf(result),
      confidence: confidenceOf(result),
      summary: summarize(result),
      detail: {
        resolution_category: result.resolution_category,
        claim_verdict: result.claim_verdict,
        supporting_count: result.supporting_count,
        refuting_count: result.refuting_count,
        primary_dimension: result.primary_hypothesis?.dimension ?? null,
        primary_strength: result.primary_hypothesis?.strength ?? null,
        primary_statement: result.primary_hypothesis?.statement ?? null,
        attributions: result.attributions.map((a) => ({
          dimension: a.dimension,
          differs: a.differs,
          strength: a.strength,
          supporting_values: a.supporting_values,
          refuting_values: a.refuting_values,
        })),
        considered_count: result.considered_count,
        below_floor_count: result.below_floor_count,
        grounding_dropped_count: result.grounding_dropped_count,
        feature_grounding_dropped_count: result.feature_grounding_dropped_count,
      },
      groundedSpans: collectSpans(result),
      usedClaude: true,
    });
  } catch (err) {
    return erroredContribution(ID, err);
  }
}

const expert: Expert = {
  id: ID,
  name: "Valsci Contradiction Atlas",
  category: "verification",
  description:
    "Resolves WHY a set of sources disagree about a claim: partitions them into supporting/refuting sides by grounded support and attributes the reversal to a study-design dimension (population / dose / tissue / follow-up) with deterministic rules.",
  gate,
  run,
};

export default expert;
