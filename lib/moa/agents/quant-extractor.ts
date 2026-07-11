// PaperTrail MoA v2 · quant-extractor — native effect-size ENRICHER.
//
// Layer-1 producer in the composition DAG. It does NOT vote on the claim: it reads the
// cached text of every source with lib/effectSize.parseEffectSizes (deterministic regex,
// no LLM, no I/O), keeps only the reconcilable RATIO measures (HR/RR/OR) that carry a
// well-formed, ordered, positive confidence interval, and PRODUCES a typed
// `effect_sizes` artifact — ParsedEffectSize[] {sourceId, measure, point, ciLow, ciHigh,
// raw} — onto the blackboard. Downstream verifiers (e.g. PyMARE meta-analysis) CONSUME
// that artifact to pool the numbers rather than re-parsing the corpus themselves.
//
// This is the numeric grounding a generic LLM claim-checker structurally cannot
// reproduce: real reported effect sizes, each traceable to a verbatim substring located
// in the source via lib/grounding.locateSpan. Any effect whose `raw` string cannot be
// located in the source is DROPPED entirely — both from the grounded spans AND from the
// produced effect_sizes artifact — so no downstream consumer ever pools an ungrounded
// (potentially fabricated) number. Every element of the produced artifact has a span.
//
// Pure and stateless: extraction is regex over cached text, grounding is exact-substring
// location, so usedClaude is always false and there is no DB pool or network. If no
// ratio effect is extracted across any source, it skips honestly.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  MoaSource,
  GroundedSpan,
  ParsedEffectSize,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import { parseEffectSizes } from "../../effectSize";
import type { ParsedEffect } from "../../effectSize";
import { locateSpan } from "../../grounding";

const AGENT_ID = "quant-extractor";

// The three ratio measures a downstream meta-analysis can pool. Percent-reduction (RRR)
// and absolute-points effects share no common numeric grammar with these, so they are
// deliberately excluded from the produced artifact.
type RatioMeasure = ParsedEffectSize["measure"];

// A ParsedEffect is a keepable ratio effect only if it is HR/RR/OR with a positive point
// estimate AND a widening (positive, ordered) confidence interval — the exact shape the
// blackboard's ParsedEffectSize type (and downstream poolers) require.
function isKeepableRatio(e: ParsedEffect): e is ParsedEffect & {
  measure: RatioMeasure;
  point: number;
  ciLow: number;
  ciHigh: number;
} {
  return (
    (e.measure === "HR" || e.measure === "RR" || e.measure === "OR") &&
    typeof e.point === "number" &&
    e.point > 0 &&
    typeof e.ciLow === "number" &&
    e.ciLow > 0 &&
    typeof e.ciHigh === "number" &&
    e.ciHigh > e.ciLow
  );
}

// Extract every keepable ratio effect from one source's cached text, tagged with the
// source id. Pure: reads only the cached text, never fetches.
function extractFromSource(source: MoaSource): ParsedEffectSize[] {
  const out: ParsedEffectSize[] = [];
  for (const e of parseEffectSizes(source.text)) {
    if (isKeepableRatio(e)) {
      out.push({
        sourceId: source.id,
        measure: e.measure,
        point: e.point,
        ciLow: e.ciLow,
        ciHigh: e.ciHigh,
        raw: e.raw,
      });
    }
  }
  return out;
}

// Per-source detail row for the UI panel — ids/measures/numbers only, never raw bodies
// beyond the short grounded effect string the extractor already matched.
interface SourceEffectDetail {
  sourceId: string;
  measure: RatioMeasure;
  point: number;
  ciLow: number;
  ciHigh: number;
  raw: string;
}

function toDetail(e: ParsedEffectSize): SourceEffectDetail {
  return {
    sourceId: e.sourceId,
    measure: e.measure,
    point: e.point,
    ciLow: e.ciLow,
    ciHigh: e.ciHigh,
    raw: e.raw,
  };
}

// Ground an extracted effect's verbatim `raw` substring back to its exact offsets in the
// owning source, using the shared grounding invariant. Skips (never fabricates) a span
// when the substring cannot be located.
function groundEffect(
  e: ParsedEffectSize,
  sources: readonly MoaSource[]
): GroundedSpan | null {
  const source = sources.find((s) => s.id === e.sourceId);
  if (source === undefined) return null;
  // Defensive: MoaSource.text is a required string in the type, but a runtime caller
  // could still hand us undefined/null. Skip (never throw) rather than let locateSpan
  // call indexOf on a non-string.
  if (!source.text) return null;
  const located = locateSpan(source.text, e.raw);
  if (located === null) return null;
  return {
    sourceId: e.sourceId,
    text: located.text,
    start: located.start,
    end: located.end,
  };
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "Effect-Size Extractor",
  category: "enricher",
  description:
    "Parses reported ratio effect sizes (HR/RR/OR with an ordered, positive confidence " +
    "interval) out of each source's cached text and produces them as a typed effect_sizes " +
    "artifact for downstream verifiers to pool. Deterministic regex extraction; no LLM, no " +
    "I/O. Enriches the blackboard; casts no support/refute vote.",

  // PRODUCES the effect_sizes artifact; CONSUMES nothing (a pure Layer-1 enricher).
  produces: ["effect_sizes"] as const,
  consumes: [] as const,

  // Eligible whenever there is at least one source to read (0.5); nothing to parse -> 0.
  // Whether any ratio effect actually parses is decided at run() (skip if none), because
  // the gate must be pure/cheap and must not depend on the blackboard.
  gate(ctx: OrchestrationContext): number {
    return ctx.sources.length >= 1 ? 0.5 : 0;
  },

  async run(
    ctx: OrchestrationContext,
    _bb: Blackboard
  ): Promise<AgentContribution> {
    void _bb; // Pure producer: reads no upstream artifacts.
    try {
      // Extract every candidate ratio effect, then keep ONLY the ones whose verbatim
      // `raw` substring grounds back to an exact offset in the owning source. The kept
      // effects and their spans are built in a single pass so the produced artifact and
      // the grounded spans stay perfectly in lockstep: a downstream consumer (PyMARE
      // pooling, etc.) never receives an ungrounded — potentially fabricated — number.
      const effects: ParsedEffectSize[] = [];
      const groundedSpans: GroundedSpan[] = [];
      for (const source of ctx.sources) {
        for (const e of extractFromSource(source)) {
          const span = groundEffect(e, ctx.sources);
          if (span === null) continue; // ungroundable -> excluded from the artifact
          effects.push(e);
          groundedSpans.push(span);
        }
      }

      const count = effects.length;
      if (count === 0) {
        return skippedContribution(
          AGENT_ID,
          "No ratio effect size (HR/RR/OR with an ordered, positive confidence interval) could be parsed and grounded to any source."
        );
      }

      // Per-source counts + rows for the detail panel.
      const perSource: Record<string, number> = {};
      for (const e of effects) {
        perSource[e.sourceId] = (perSource[e.sourceId] ?? 0) + 1;
      }
      const sourcesWithEffects = Object.keys(perSource).length;

      // Deterministic confidence: more extracted effects => a richer numeric substrate
      // for downstream poolers. Monotone, saturating, never an LLM number.
      const confidence = clamp01(count / (count + 2));

      const summary =
        `Extracted ${count} ratio effect size${count === 1 ? "" : "s"} ` +
        `(HR/RR/OR + CI) from ${sourcesWithEffects} of ${ctx.sources.length} source${
          ctx.sources.length === 1 ? "" : "s"
        }.`;

      return makeContribution(AGENT_ID, {
        ran: true,
        // Enricher: it enriches the blackboard, it does not vote on the claim.
        signal: "neutral",
        confidence,
        summary,
        detail: {
          totalEffects: count,
          sourcesScanned: ctx.sources.length,
          sourcesWithEffects,
          groundedSpanCount: groundedSpans.length,
          perSourceCounts: perSource,
          effects: effects.map(toDetail),
        },
        groundedSpans,
        usedClaude: false,
        produced: { effect_sizes: effects },
      });
    } catch (err) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
