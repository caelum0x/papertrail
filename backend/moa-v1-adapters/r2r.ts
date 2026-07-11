// PaperTrail MoA expert · R2R RAG-Fusion facet COVERAGE (context/weighting expert).
//
// R2R's RAG-Fusion (lib/retrieval/hybrid.ts) decomposes a claim into fixed biomedical
// facets — efficacy / safety / mechanism / subgroup — retrieves per facet, and fuses
// the rankings. That full pipeline (ragFusionRetrieve -> hybridSearch) needs a Postgres
// pool + embeddings, which the stateless orchestrator does not provide. So this adapter
// reuses ONLY the PURE, deterministic pieces R2R already exports — RAG_FUSION_FACETS,
// FACET_CUES, decomposeIntoFacets — and answers a narrower, stateless question:
//
//   Of R2R's biomedical facets, how many are COVERED by the sources already in context?
//
// Coverage is a deterministic keyword test: a facet is covered by a source when the
// source text contains at least one of that facet's cue terms (or the facet name). This
// tells the mix whether the evidence set spans the clinical lenses the claim implies —
// a facet with zero covering sources is a coverage GAP, not a refutation.
//
// This is a CONTEXT/weighting expert: it reports coverage, it does NOT vote on whether
// the claim is true. Signal is always `neutral`. Fully deterministic — same input always
// yields the same contribution. No LLM, no I/O, no DB pool: usedClaude is always false.

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
  RAG_FUSION_FACETS,
  FACET_CUES,
  decomposeIntoFacets,
  type RagFusionFacet,
} from "../../retrieval/hybrid";

const EXPERT_ID = "r2r";

// A cue matches a source when it appears as a whole-word (case-insensitive) token run in
// the source text. Whole-word matching keeps "age" (subgroup) from firing on "manage" or
// "dosage" — deterministic and free of accidental substring hits.
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function cueMatches(normalizedText: string, cue: string): boolean {
  const normalizedCue = cue.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalizedCue.length === 0) return false;
  return normalizedText.includes(` ${normalizedCue} `);
}

// The cue vocabulary for a facet: its fixed cue terms plus the facet name itself, so the
// bare word "efficacy"/"safety"/"mechanism"/"subgroup" also counts as coverage.
function facetVocabulary(facet: RagFusionFacet): readonly string[] {
  return [facet, ...FACET_CUES[facet]];
}

// Which sources cover a facet, and via which cue term (first match wins, for provenance).
interface FacetCoverage {
  facet: RagFusionFacet;
  coveredSourceIds: string[];
  matchedCues: string[];
  covered: boolean;
}

function coverFacet(
  facet: RagFusionFacet,
  normalizedSources: readonly { id: string; normalized: string }[]
): FacetCoverage {
  const vocab = facetVocabulary(facet);
  const coveredSourceIds: string[] = [];
  const matchedCues = new Set<string>();
  for (const src of normalizedSources) {
    const hit = vocab.find((cue) => cueMatches(src.normalized, cue));
    if (hit !== undefined) {
      coveredSourceIds.push(src.id);
      matchedCues.add(hit);
    }
  }
  return {
    facet,
    coveredSourceIds,
    matchedCues: [...matchedCues],
    covered: coveredSourceIds.length > 0,
  };
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "R2R RAG-Fusion Facet Coverage",
  category: "retrieval",
  description:
    "Decomposes the claim into R2R's biomedical facets (efficacy / safety / mechanism / subgroup) and scores how many of the sources in context cover each facet by deterministic keyword match. Reports coverage/gaps as context; casts no support/refute vote.",

  // Moderate relevance whenever there is at least one source to test coverage against.
  // The facet template is claim-agnostic, so the only precondition is having sources; a
  // non-empty claim lifts the gate slightly because the decomposition is meaningful.
  // No sources -> nothing to cover -> gate 0.
  gate(ctx: OrchestrationContext): number {
    if (ctx.sources.length === 0) return 0;
    const hasClaim = ctx.claim.trim().length > 0;
    return clamp01(hasClaim ? 0.5 : 0.4);
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    if (ctx.sources.length === 0) {
      return skippedContribution(
        EXPERT_ID,
        "No sources in context — facet coverage had nothing to score."
      );
    }

    try {
      // Reuse R2R's PURE decomposition so the facet set stays in lock-step with the
      // engine's own template (decomposeIntoFacets returns [] for a blank claim).
      const facetQueries = decomposeIntoFacets(ctx.claim);
      const activeFacets: readonly RagFusionFacet[] =
        facetQueries.length > 0
          ? facetQueries.map((f) => f.facet)
          : RAG_FUSION_FACETS;

      const normalizedSources = ctx.sources.map((s: MoaSource) => ({
        id: s.id,
        normalized: normalize(`${s.title ?? ""} ${s.text}`),
      }));

      const coverages = activeFacets.map((facet) =>
        coverFacet(facet, normalizedSources)
      );

      const coveredCount = coverages.filter((c) => c.covered).length;
      const totalFacets = coverages.length;

      // Confidence = fraction of facets covered by >=1 source. Deterministic, in [0,1].
      const confidence = clamp01(totalFacets > 0 ? coveredCount / totalFacets : 0);

      const coveredFacets = coverages.filter((c) => c.covered).map((c) => c.facet);
      const gapFacets = coverages.filter((c) => !c.covered).map((c) => c.facet);

      const perFacet = coverages.map((c) => ({
        facet: c.facet,
        covered: c.covered,
        coveredSourceCount: c.coveredSourceIds.length,
        coveredSourceIds: c.coveredSourceIds,
        matchedCues: c.matchedCues,
      }));

      const summary =
        gapFacets.length === 0
          ? `All ${totalFacets} R2R facets covered by the sources in context (efficacy / safety / mechanism / subgroup).`
          : `${coveredCount}/${totalFacets} R2R facets covered; coverage gap: ${gapFacets.join(", ")}.`;

      return makeContribution(EXPERT_ID, {
        ran: true,
        // Coverage is context/weighting, not a directional read on the claim.
        signal: "neutral",
        confidence,
        summary,
        detail: {
          totalFacets,
          coveredCount,
          coverageFraction: confidence,
          coveredFacets,
          gapFacets,
          sourceCount: ctx.sources.length,
          perFacet,
        },
        // Coverage is keyword-level over source text; no verbatim span is surfaced as a
        // grounded quote (the engine's grounding lives in its retrieval leg, unused here).
        groundedSpans: [],
        usedClaude: false,
      });
    } catch (err) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
