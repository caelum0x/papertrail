// PaperTrail MoA v2 · R2R — the RAG-Fusion facet-COVERAGE enricher.
//
// R2R's RAG-Fusion (lib/retrieval/hybrid.ts) decomposes a claim into four fixed biomedical
// facets — efficacy / safety / mechanism / subgroup — retrieves per facet, and fuses the
// rankings. That full pipeline (ragFusionRetrieve -> hybridSearch) needs a Postgres pool +
// embeddings, which the stateless orchestrator does not provide. So this agent reuses ONLY
// the PURE, deterministic pieces R2R already exports — RAG_FUSION_FACETS, FACET_CUES,
// decomposeIntoFacets — and answers a narrower, fully-stateless question:
//
//   Of R2R's biomedical facets, how many are COVERED by the sources already in context?
//
// Coverage is a deterministic keyword test: a facet is covered by a source when the source
// text contains at least one of that facet's cue terms (or the facet name itself). This tells
// the mix whether the evidence set spans the clinical lenses the claim implies — a facet with
// zero covering sources is a coverage GAP, not a refutation.
//
// COMPOSITION CONTRACT
//   produces: []  — a CONTEXT/weighting enricher. It reports coverage; it writes no artifact
//     other agents consume, and it casts no support/refute vote. Signal is always `neutral`.
//   consumes: ["entities"] — OPTIONAL. If scispaCy produced grounded biomedical entity
//     mentions, R2R reads them to enrich its trace (how many covered sources also carry a
//     recognized normalized entity). This is advisory only: it never touches the deterministic
//     coverage arithmetic, and R2R works fully without it (degrades to a null enrichment).
//
// Fully deterministic — same input always yields the same contribution. No LLM, no I/O, no DB
// pool: usedClaude is always false. If R2R's own facet fn ever needed a pool, the pure
// keyword-coverage logic below is self-contained and independent of it.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  MoaSource,
  EntityMention,
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

const AGENT_ID = "r2r";

// Eligibility: the facet template is claim-agnostic, so the only precondition is having at
// least one source to test coverage against. Fixed moderate gate per spec.
const GATE_WITH_SOURCE = 0.45;

// Cap how many covered source ids we echo per facet so the UI trace stays light.
const MAX_DETAIL_SOURCE_IDS = 25;

// Normalize text into a space-padded, single-spaced, alphanumeric token stream so cue matches
// can be tested as whole-word (case-insensitive) runs. Whole-word matching keeps "age"
// (subgroup) from firing on "manage" or "dosage" — deterministic, no accidental substrings.
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

// A cue matches when it appears as a whole-word token run inside the normalized source text.
function cueMatches(normalizedText: string, cue: string): boolean {
  const normalizedCue = cue.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalizedCue.length === 0) return false;
  return normalizedText.includes(` ${normalizedCue} `);
}

// The cue vocabulary for a facet: its fixed R2R cue terms plus the facet name itself, so the
// bare word "efficacy"/"safety"/"mechanism"/"subgroup" also counts as coverage.
function facetVocabulary(facet: RagFusionFacet): readonly string[] {
  return [facet, ...FACET_CUES[facet]];
}

// Which sources cover a facet, and via which cue terms (deduped, for provenance).
interface FacetCoverage {
  facet: RagFusionFacet;
  coveredSourceIds: string[];
  matchedCues: string[];
  covered: boolean;
}

// Pure keyword-coverage fallback — self-contained, independent of R2R's DB-backed retrieval.
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

// Advisory enrichment: how many covered sources also carry a recognized normalized biomedical
// entity per scispaCy's `entities` artifact. Never affects coverage — trace only.
function coveredSourcesWithEntities(
  coverages: readonly FacetCoverage[],
  entities: readonly EntityMention[]
): number {
  const idsWithEntity = new Set<string>();
  for (const mention of entities) {
    if (mention.curie !== null) idsWithEntity.add(mention.sourceId);
  }
  const coveredIds = new Set<string>();
  for (const c of coverages) {
    for (const id of c.coveredSourceIds) coveredIds.add(id);
  }
  let n = 0;
  for (const id of coveredIds) {
    if (idsWithEntity.has(id)) n += 1;
  }
  return n;
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "R2R RAG-Fusion facet-coverage enricher",
  category: "retrieval",
  description:
    "Decomposes the claim into R2R's biomedical facets (efficacy / safety / mechanism / " +
    "subgroup) and scores how many of the sources in context cover each facet by " +
    "deterministic keyword match. Reports coverage and gaps as context; casts no " +
    "support/refute vote.",

  // Context/weighting enricher: it writes no consumable artifact, only a coverage trace.
  produces: [] as const,
  // Optional: reads scispaCy entity mentions to enrich the trace. R2R runs without them.
  consumes: ["entities"] as const,

  // PURE + DETERMINISTIC from the INPUT ONLY (never the blackboard): moderate relevance
  // whenever there is at least one source to test coverage against; nothing to cover -> 0.
  gate(ctx: OrchestrationContext): number {
    if (ctx.sources.length === 0) return 0;
    return clamp01(GATE_WITH_SOURCE);
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    if (ctx.sources.length === 0) {
      return skippedContribution(
        AGENT_ID,
        "No sources in context — facet coverage had nothing to score."
      );
    }

    try {
      // Reuse R2R's PURE decomposition so the facet set stays in lock-step with the engine's
      // own template. decomposeIntoFacets returns [] for a blank claim; fall back to the full
      // fixed facet set so coverage is still meaningful for a claimless source dump.
      const facetQueries = decomposeIntoFacets(ctx.claim);
      const activeFacets: readonly RagFusionFacet[] =
        facetQueries.length > 0 ? facetQueries.map((f) => f.facet) : RAG_FUSION_FACETS;

      const normalizedSources = ctx.sources.map((s: MoaSource) => ({
        id: s.id,
        normalized: normalize(`${s.title ?? ""} ${s.text}`),
      }));

      const coverages = activeFacets.map((facet) => coverFacet(facet, normalizedSources));

      const coveredCount = coverages.filter((c) => c.covered).length;
      const totalFacets = coverages.length;

      // Confidence = fraction of facets covered by >=1 source. Deterministic, in [0,1].
      const confidence = clamp01(totalFacets > 0 ? coveredCount / totalFacets : 0);

      const coveredFacets = coverages.filter((c) => c.covered).map((c) => c.facet);
      const gapFacets = coverages.filter((c) => !c.covered).map((c) => c.facet);

      // Per-facet covered-source counts — the core detail payload the spec asks for.
      const perFacet = coverages.map((c) => ({
        facet: c.facet,
        covered: c.covered,
        coveredSourceCount: c.coveredSourceIds.length,
        coveredSourceIds: c.coveredSourceIds.slice(0, MAX_DETAIL_SOURCE_IDS),
        coveredSourceIdsTruncated: c.coveredSourceIds.length > MAX_DETAIL_SOURCE_IDS,
        matchedCues: c.matchedCues,
      }));

      // COMPOSE (optional): if scispaCy produced grounded entity mentions, note how many of
      // the covered sources carry a recognized normalized entity. Advisory trace only.
      const entities = bb.get("entities");
      const coveredWithEntities =
        entities !== undefined && entities.length > 0
          ? coveredSourcesWithEntities(coverages, entities)
          : null;

      const summary =
        gapFacets.length === 0
          ? `All ${totalFacets} R2R facets covered by the sources in context ` +
            `(efficacy / safety / mechanism / subgroup).`
          : `${coveredCount}/${totalFacets} R2R facets covered; coverage gap: ` +
            `${gapFacets.join(", ")}.`;

      return makeContribution(AGENT_ID, {
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
          usedFullFacetFallback: facetQueries.length === 0,
          consumedEntities: entities !== undefined,
          coveredSourcesWithEntities: coveredWithEntities,
          perFacet,
        },
        // Coverage is keyword-level over source text; the engine's verbatim grounding lives
        // in its retrieval leg (unused here), so no grounded span is fabricated.
        groundedSpans: [],
        usedClaude: false,
        // Enricher: no consumable artifact produced.
        produced: {},
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
