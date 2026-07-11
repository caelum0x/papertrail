// PaperTrail MoA v2 agent · Valsci CONTRADICTION verifier (LAYER 2 · VERIFICATION).
//
// COMPOSITION ROLE. This agent does NOT run blind. It CONSUMES two upstream artifacts and
// PRODUCES one for the deliberation layer:
//
//   CONSUMES  source_labels  (MiniCheck) — per-source SUPPORTS/REFUTES/NEI + grounded span.
//             entities       (scispaCy)  — grounded biomedical mentions, used to enrich the
//                                          contested detail (what the disagreeing sources are
//                                          actually about) without changing the verdict.
//   PRODUCES  contested      (ContestedFinding) — WHICH sources conflict + on WHAT design
//                                          dimension + the resolution category. STORM debates
//                                          exactly this contested finding downstream.
//
// It builds on MiniCheck's labels rather than re-deriving directionality: the disagreeing
// SIDES are identified from bb.get("source_labels") (SUPPORTS vs REFUTES). It then runs the
// deterministic Valsci contradiction atlas (lib/contradiction/atlas resolveContradiction) to
// resolve WHY the sides disagree — attributing any reversal to a study-design dimension
// (population / dose / tissue / follow_up) with deterministic rules — and emits that as the
// typed `contested` artifact.
//
// VOTE. mixed when a contradiction is attributed or a two-sided conflict is found; neutral
// when the atlas finds no two-sided conflict; insufficient otherwise. Confidence comes from
// the atlas' deterministic resolution strength, never from Claude.
//
// ENGINE BOUNDARY (honored exactly like app/api/verify/contradiction-resolve/route.ts):
//   - We pass the production Claude source-scorer + feature tagger and OMIT the mechanism dep
//     (that path needs a DB pool / persistence; the atlas degrades to belief 0 statelessly).
//   - Both learned steps require Claude. When ctx.options.llm is false we cannot supply a
//     deterministic substitute without inventing scores, so we skip honestly.
//   - Every grounded span is a verbatim substring the atlas already grounded (Valsci support
//     spans + located design-feature quotes) — never fabricated here.
//   - usedClaude = ctx.options.llm (the feature tagger + source scorer run Claude when true).
//
// This UPGRADES backend/moa-v1-adapters/valsci.ts to the v2 composition contract: the v1
// adapter re-derived directional leans from raw text to gate/vote; here the disagreeing sides
// come from the CONSUMED source_labels, and the resolution is PUBLISHED as a `contested`
// artifact for STORM.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  MoaSource,
  SourceLabel,
  EntityMention,
  ContestedFinding,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
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

const AGENT_ID = "valsci";

// The atlas needs at least two sources to have two sides at all.
const MIN_SOURCES = 2;

// Minimum source body length the atlas request schema accepts (schemas.ts: raw_text min 40).
const MIN_SOURCE_CHARS = 40;

// How many grounded spans (support spans + differing-feature quotes) to surface, capped so
// the contribution stays small for the detail panel.
const MAX_SPANS = 8;

// Gate weights — deterministic eligibility from the INPUT alone.
const GATE_PLAUSIBLE = 0.8; // >=2 sources and a plausible disagreement.
const GATE_FLOOR = 0.2; // >=2 sources but no obvious disagreement — latent conflict still possible.
const GATE_NONE = 0; // fewer than two usable sources, or Claude disabled.

// Lexical cues that a set plausibly DISAGREES on direction — a reduction/benefit reading
// alongside a no-effect / null / increase reading. Deterministic, no I/O; only nudges the gate.
const REDUCTION_CUES = [
  "reduc",
  "lower",
  "decreas",
  "decline",
  "improv",
  "protect",
  "benefit",
  "effica",
] as const;
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
] as const;

function hasAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// A cheap deterministic directional read for GATING only (never a verdict). "reduction" if the
// text leans toward an effect, "null_or_opposite" if it leans against, "unknown" otherwise.
type Lean = "reduction" | "null_or_opposite" | "unknown";

function leanOf(text: string): Lean {
  const t = text.toLowerCase();
  if (hasAny(t, NULL_OR_OPPOSITE_CUES)) return "null_or_opposite";
  if (hasAny(t, REDUCTION_CUES)) return "reduction";
  return "unknown";
}

// Deterministic eligibility, INPUT only (never the blackboard — gate runs before scheduling).
// This is a CONSUMER: it gates on the eligibility precondition that upstream labels will be
// producible (>= MIN_SOURCES usable sources), not on the labels themselves (which don't exist
// yet). 0.8 when a disagreement is plausible — conflicting pre-classification labels on the
// input OR opposing directional cues (sources leaning both ways, or the claim leaning opposite
// a source). 0.2 floor otherwise: a set of >=2 sources can still hide a latent conflict Valsci
// surfaces, but we shouldn't over-gate. Claude disabled -> 0 (the learned steps can't run).
function gate(ctx: OrchestrationContext): number {
  if (!ctx.options.llm) return GATE_NONE;

  const usable = ctx.sources.filter((s) => s.text.trim().length >= MIN_SOURCE_CHARS);
  if (usable.length < MIN_SOURCES) return GATE_NONE;

  // Signal 1: conflicting pre-classification labels on the input (some SUPPORTS, some REFUTES).
  const labels = new Set(
    usable.map((s) => s.label).filter((l): l is NonNullable<MoaSource["label"]> => l !== undefined)
  );
  const conflictingLabels = labels.has("SUPPORTS") && labels.has("REFUTES");

  // Signal 2: opposing directional leans across the source text.
  let sawReduction = false;
  let sawOpposite = false;
  for (const s of usable) {
    const lean = leanOf(s.text);
    if (lean === "reduction") sawReduction = true;
    else if (lean === "null_or_opposite") sawOpposite = true;
  }
  const claimLean = leanOf(ctx.claim);
  const claimVsSource =
    (claimLean === "reduction" && sawOpposite) ||
    (claimLean === "null_or_opposite" && sawReduction);

  const plausibleDisagreement =
    conflictingLabels || (sawReduction && sawOpposite) || claimVsSource;

  return plausibleDisagreement ? GATE_PLAUSIBLE : GATE_FLOOR;
}

// Confidence from the atlas' deterministic resolution strength.
//   attributed_reversal   -> primary_hypothesis.strength (the winning dimension's strength)
//   unattributed_conflict -> a modest floor: two real sides exist but no clean attribution
//   no_conflict           -> low: sides don't straddle, little for this verifier to add
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
//   attributed_reversal / unattributed_conflict -> "mixed" (a real two-sided contradiction).
//   no_conflict  -> "neutral" (no two-sided disagreement to weigh in on).
//   insufficient -> "insufficient" (too few grounded, directional sources).
function signalOf(result: ContradictionAtlasResult): AgentContribution["signal"] {
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
        // A GroundedFeature carries no source id; label by dimension so the panel can attribute
        // it to the winning axis without fabricating a source id.
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

function summarize(
  result: ContradictionAtlasResult,
  labelledSides: { supports: number; refutes: number }
): string {
  const s = result.supporting_count;
  const r = result.refuting_count;
  switch (result.resolution_category) {
    case "attributed_reversal": {
      const dim = result.primary_hypothesis?.dimension ?? "a design dimension";
      return `MiniCheck labelled ${labelledSides.supports} supporting vs ${labelledSides.refutes} refuting; Valsci confirms a contradiction (${s} vs ${r}) attributed to ${dim}.`;
    }
    case "unattributed_conflict":
      return `Sources disagree (${s} supporting vs ${r} refuting) but no single design dimension cleanly explains the reversal.`;
    case "no_conflict":
      return `No two-sided disagreement: the grounded sources do not straddle both sides.`;
    case "insufficient":
      return `Too few grounded, directional sources to resolve a contradiction.`;
  }
}

// Build the typed `contested` artifact STORM debates downstream. The conflicting sourceIds are
// the union of the atlas' supporting + refuting external_ids (which ARE the MoA source ids —
// see the mapping in run). dimension/category come from the deterministic resolution.
function toContested(result: ContradictionAtlasResult): ContestedFinding {
  const sourceIds = [
    ...result.supporting.map((v) => v.external_id),
    ...result.refuting.map((v) => v.external_id),
  ];
  // Dedupe while preserving order (a source can only be on one side, but stay defensive).
  const uniqueIds = Array.from(new Set(sourceIds));
  const dimension = result.primary_hypothesis?.dimension ?? "unattributed";
  return {
    sourceIds: uniqueIds,
    dimension,
    category: result.resolution_category,
  };
}

// Which MoA source ids MiniCheck labelled on each side, from the consumed source_labels. Used
// to identify the disagreeing sides and to enrich the summary/detail. Read-only compose step.
function sidesFromLabels(labels: readonly SourceLabel[]): {
  supportsIds: string[];
  refutesIds: string[];
} {
  const supportsIds: string[] = [];
  const refutesIds: string[] = [];
  for (const l of labels) {
    if (l.label === "SUPPORTS") supportsIds.push(l.sourceId);
    else if (l.label === "REFUTES") refutesIds.push(l.sourceId);
  }
  return { supportsIds, refutesIds };
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "Valsci Contradiction Verifier",
  category: "verification",
  description:
    "Consumes MiniCheck source labels and scispaCy entities to identify disagreeing sources, then resolves WHY they conflict — attributing any reversal to a study-design dimension (population / dose / tissue / follow-up) with deterministic rules — and produces a `contested` artifact for STORM to debate.",

  // VERIFIER: produces the contested finding STORM consumes.
  produces: ["contested"] as const,
  // Consumes MiniCheck labels (the disagreeing sides) + scispaCy entities (topic enrichment).
  consumes: ["source_labels", "entities"] as const,

  gate,

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    // Honest stateless skip: the atlas' two learned steps (support scoring + feature tagging)
    // require Claude; we cannot supply deterministic substitutes without inventing scores.
    if (!ctx.options.llm) {
      return skippedContribution(
        AGENT_ID,
        "Valsci contradiction verifier needs Claude for source scoring + feature tagging; skipped in deterministic-only mode."
      );
    }

    const usable = ctx.sources.filter((s) => s.text.trim().length >= MIN_SOURCE_CHARS);
    if (usable.length < MIN_SOURCES) {
      return skippedContribution(
        AGENT_ID,
        "Needs at least two sources with extractable text to look for a contradiction."
      );
    }

    // COMPOSE: read MiniCheck's per-source labels. This is the whole point — the disagreeing
    // sides come from the upstream verifier, not from re-deriving directionality here.
    const labels = bb.get("source_labels");
    if (!labels || labels.length === 0) {
      // Degrade honestly: without upstream labels this verifier has nothing to build on. The
      // v1 adapter re-derived leans from raw text; in the v2 composition contract we depend on
      // MiniCheck and skip rather than silently duplicating its job at lower fidelity.
      return skippedContribution(
        AGENT_ID,
        "No upstream source labels available (MiniCheck did not produce `source_labels`); nothing to build a contradiction on."
      );
    }

    const { supportsIds, refutesIds } = sidesFromLabels(labels);

    // If MiniCheck labelled every source the same way (or all NEI), there are not two labelled
    // sides. The atlas may still surface a latent conflict from its own signed support scores,
    // so we proceed, but record that the labelled sides did not straddle.
    const labelledStraddle = supportsIds.length > 0 && refutesIds.length > 0;

    // Optional enrichment: scispaCy entities describe WHAT the disagreeing sources are about.
    // Consumed for the detail panel only; it never changes the verdict.
    const entities = bb.get("entities");

    try {
      // Map MoA sources onto the atlas' ContradictionSourceInput shape. external_id === the MoA
      // source id, so the produced ContestedFinding.sourceIds map back to real sources.
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

      const contested = toContested(result);

      // Only publish a contested artifact when a real two-sided conflict exists — STORM should
      // debate an actual contradiction, not an empty one.
      const hasConflict =
        result.resolution_category === "attributed_reversal" ||
        result.resolution_category === "unattributed_conflict";

      const entityCount = entities ? entities.length : 0;
      const contestedEntities = summarizeContestedEntities(entities, contested.sourceIds);

      return makeContribution(AGENT_ID, {
        ran: true,
        signal: signalOf(result),
        confidence: confidenceOf(result),
        summary: summarize(result, {
          supports: supportsIds.length,
          refutes: refutesIds.length,
        }),
        detail: {
          resolution_category: result.resolution_category,
          claim_verdict: result.claim_verdict,
          // Composed-in provenance: which sides MiniCheck labelled + whether they straddled.
          minicheck_supports_ids: supportsIds,
          minicheck_refutes_ids: refutesIds,
          minicheck_labelled_straddle: labelledStraddle,
          minicheck_label_count: labels.length,
          entity_count: entityCount,
          contested_entities: contestedEntities,
          contested_source_ids: contested.sourceIds,
          contested_dimension: contested.dimension,
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
          published_contested: hasConflict,
        },
        groundedSpans: collectSpans(result),
        usedClaude: true,
        // PRODUCE the contested artifact only when there is a genuine conflict for STORM.
        produced: hasConflict ? { contested } : {},
      });
    } catch (err) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

// Distinct entity texts (from scispaCy) that belong to the contested sources — a compact,
// non-verdict description of what the disagreement is about. Ids only, never raw source text.
function summarizeContestedEntities(
  entities: readonly EntityMention[] | undefined,
  contestedSourceIds: readonly string[]
): string[] {
  if (!entities || entities.length === 0) return [];
  const inConflict = new Set(contestedSourceIds);
  const texts = new Set<string>();
  for (const e of entities) {
    if (!inConflict.has(e.sourceId)) continue;
    const t = e.text.trim();
    if (t.length > 0) texts.add(t);
  }
  return Array.from(texts).slice(0, 12);
}

export default agent;
