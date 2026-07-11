// PaperTrail MoA expert · paper-qa source-quality tiering (WEIGHTING expert).
//
// paper-qa's synthesis treats every retrieved passage as equally trustworthy once it
// clears retrieval; PaperTrail cannot. This expert wraps lib/paperqa/sourceQuality.ts to
// assign each source a QUALITY TIER (A/B/C/D) and a WEIGHT in [0,1] from its metadata
// alone — so the aggregator can DOWN-WEIGHT low-tier evidence instead of counting it at
// face value. It does not read the claim and casts no support/refute vote: its signal is
// always `neutral` (it WEIGHTS the mix, it does not vote on the claim).
//
// Deterministic end-to-end: tier and weight are a pure function of metadata, so the same
// input always yields the same contribution. No LLM, no I/O, no DB pool — usedClaude is
// always false. Stateless: safe to run inside the stateless orchestrator.

import type {
  Expert,
  OrchestrationContext,
  ExpertContribution,
  MoaSource,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import {
  scoreSourceQualityBatch,
  type SourceQualityMeta,
  type SourceQualityResult,
} from "../../paperqa/sourceQuality";

const EXPERT_ID = "paperqa";

// Per-source detail row surfaced to the UI detail panel. Ids/tiers/weights only — never
// raw source text or secrets.
interface SourceTierDetail {
  id: string;
  tier: SourceQualityResult["tier"];
  tierLabel: string;
  weight: number;
  retracted: boolean;
}

// Translate an orchestrator MoaSource into the metadata shape the paper-qa scorer accepts.
// MoaSource carries no Retraction Watch id, so only the explicit `retracted` flag is
// forwarded; every field is optional and the scorer defensively narrows it.
function toQualityMeta(source: MoaSource): SourceQualityMeta {
  return {
    id: source.id,
    journal: source.journal ?? null,
    year: source.year ?? null,
    citations: source.citations ?? null,
    is_preprint: source.isPreprint ?? null,
    is_open_access: source.isOpenAccess ?? null,
    retracted: source.retracted ?? null,
  };
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "paper-qa Source-Quality Tiers",
  category: "meta",
  description:
    "Assigns each source a quality tier (A/B/C/D) and weight from its metadata so the mix can down-weight preprints, low-cited, and retracted evidence. Weights the verdict; casts no support/refute vote.",

  // Moderate, always-available relevance: the scorer can tier any source from its
  // metadata (or documented defaults) as long as at least one source exists. Retracted
  // sources are exactly what this expert exists to flag, so gate slightly higher when one
  // is present. No sources at all -> nothing to weight -> gate 0.
  gate(ctx: OrchestrationContext): number {
    const count = ctx.sources.length;
    if (count === 0) return 0;
    const hasRetracted = ctx.sources.some((s) => s.retracted === true);
    return clamp01(hasRetracted ? 0.7 : 0.5);
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    if (ctx.sources.length === 0) {
      return skippedContribution(
        EXPERT_ID,
        "No sources to tier — source-quality weighting had nothing to score."
      );
    }

    try {
      const metas = ctx.sources.map(toQualityMeta);
      const results = scoreSourceQualityBatch(metas);

      const detailRows: SourceTierDetail[] = results.map((r) => ({
        id: r.id,
        tier: r.tier,
        tierLabel: r.tierLabel,
        weight: r.weight,
        retracted: r.retracted,
      }));

      // Confidence is the mean quality weight across sources — how much trust the tiers
      // collectively confer on the available evidence. Deterministic, in [0,1].
      const meanWeight =
        results.reduce((sum, r) => sum + r.weight, 0) / results.length;
      const confidence = clamp01(meanWeight);

      const retractedIds = results.filter((r) => r.retracted).map((r) => r.id);
      const tierCounts = results.reduce<Record<string, number>>((acc, r) => {
        acc[r.tier] = (acc[r.tier] ?? 0) + 1;
        return acc;
      }, {});

      const summary =
        retractedIds.length > 0
          ? `Tiered ${results.length} source${results.length === 1 ? "" : "s"}; ${retractedIds.length} RETRACTED (Tier D, weight 0) — evidence down-weighted accordingly.`
          : `Tiered ${results.length} source${results.length === 1 ? "" : "s"} by quality; mean trust weight ${confidence.toFixed(2)}.`;

      return makeContribution(EXPERT_ID, {
        ran: true,
        // Weighting expert: contributes source-quality context, never a support/refute vote.
        signal: "neutral",
        confidence,
        summary,
        detail: {
          sourceCount: results.length,
          meanWeight: confidence,
          tierCounts,
          retractedIds,
          retractedCount: retractedIds.length,
          perSource: detailRows,
        },
        // No grounded quotes: tiering reads metadata only, never the source body.
        groundedSpans: [],
        usedClaude: false,
      });
    } catch (err) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
