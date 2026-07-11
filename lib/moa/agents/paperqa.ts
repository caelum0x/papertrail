// PaperTrail MoA v2 agent · paper-qa source-quality ENRICHER (produces "quality").
//
// paper-qa's synthesis treats every retrieved passage as equally trustworthy once it
// clears retrieval; PaperTrail cannot. This enricher wraps lib/paperqa/sourceQuality.ts
// to assign each source a QUALITY TIER (A/B/C/D) and a WEIGHT in [0,1] from its metadata
// alone, then PRODUCES a typed `quality` artifact onto the blackboard:
//
//   SourceQuality { weightById: {sourceId:{tier,weight}}, meanWeight, retractedIds }
//
// Downstream verifiers/aggregation CONSUME this artifact to DOWN-WEIGHT low-tier evidence
// instead of counting it at face value. It does not read the claim and casts no
// support/refute vote — its signal is always `neutral` (it weights the mix, it does not
// vote on the claim). It CONSUMES nothing, so it sits in the first (enricher) layer.
//
// Deterministic end-to-end: tier and weight are a pure function of metadata, so the same
// input always yields the same contribution. No LLM, no I/O, no DB pool — usedClaude is
// always false. Stateless: safe to run inside the stateless scheduler.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  MoaSource,
  SourceQuality,
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

const AGENT_ID = "paperqa";

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

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "paper-qa Source-Quality Tiers",
  category: "enricher",
  description:
    "Enricher: assigns each source a quality tier (A/B/C/D) and weight from its metadata and produces a `quality` artifact so downstream agents can down-weight preprints, low-cited, and retracted evidence. Weights the verdict; casts no support/refute vote.",

  // ENRICHER: produces the typed quality weighting; consumes nothing (first layer).
  produces: ["quality"] as const,
  consumes: [] as const,

  // Deterministic eligibility from the input alone: as long as >=1 source exists there is
  // something to tier (the scorer works from metadata or documented defaults). No sources
  // -> nothing to weight -> gate 0.
  gate(ctx: OrchestrationContext): number {
    return ctx.sources.length >= 1 ? 0.5 : 0;
  },

  async run(
    ctx: OrchestrationContext,
    _bb: Blackboard
  ): Promise<AgentContribution> {
    // Enricher consumes nothing, so the blackboard is intentionally unused here.
    void _bb;

    if (ctx.sources.length === 0) {
      return skippedContribution(
        AGENT_ID,
        "No sources to tier — source-quality weighting had nothing to score."
      );
    }

    try {
      const metas = ctx.sources.map(toQualityMeta);
      const results = scoreSourceQualityBatch(metas);

      // Build the typed `quality` artifact for downstream consumers.
      const weightById: SourceQuality["weightById"] = {};
      for (const r of results) {
        weightById[r.id] = { tier: r.tier, weight: r.weight };
      }

      // Mean quality weight: how much trust the tiers collectively confer on the available
      // evidence. Deterministic, in [0,1]. This is the trust multiplier the aggregator reads.
      const meanWeight = clamp01(
        results.reduce((sum, r) => sum + r.weight, 0) / results.length
      );

      const retractedIds = results.filter((r) => r.retracted).map((r) => r.id);

      const qualityArtifact: SourceQuality = {
        weightById,
        meanWeight,
        retractedIds,
      };

      const detailRows: SourceTierDetail[] = results.map((r) => ({
        id: r.id,
        tier: r.tier,
        tierLabel: r.tierLabel,
        weight: r.weight,
        retracted: r.retracted,
      }));

      const tierCounts = results.reduce<Record<string, number>>((acc, r) => {
        acc[r.tier] = (acc[r.tier] ?? 0) + 1;
        return acc;
      }, {});

      const summary =
        retractedIds.length > 0
          ? `${retractedIds.length} RETRACTED source${retractedIds.length === 1 ? "" : "s"} flagged (Tier D, weight 0) — evidence down-weighted; tiered ${results.length} source${results.length === 1 ? "" : "s"}, mean trust ${meanWeight.toFixed(2)}.`
          : `Tiered ${results.length} source${results.length === 1 ? "" : "s"} by quality; mean trust weight ${meanWeight.toFixed(2)}.`;

      return makeContribution(AGENT_ID, {
        ran: true,
        // Enricher: contributes source-quality context, never a support/refute vote.
        signal: "neutral",
        // Confidence is the mean quality weight — collective trust in the evidence.
        confidence: meanWeight,
        summary,
        detail: {
          // The aggregator reads detail.qualityWeight as a trust multiplier.
          qualityWeight: meanWeight,
          sourceCount: results.length,
          meanWeight,
          tierCounts,
          retractedIds,
          retractedCount: retractedIds.length,
          perSource: detailRows,
        },
        // No grounded quotes: tiering reads metadata only, never the source body.
        groundedSpans: [],
        usedClaude: false,
        // Publish the typed artifact for the composition DAG.
        produced: { quality: qualityArtifact },
      });
    } catch (err) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
