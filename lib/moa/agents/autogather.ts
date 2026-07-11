// PaperTrail MoA v2 · AUTOGATHER — the coverage-GAP deliberation agent.
//
// Productionizes lucereal/AutoResearcher's query-generation + coverage-gap analysis, but
// TRUSTED biomedical sources ONLY and with NO live fetch: it never queries PubMed, the web,
// or any social feed. Instead it asks a narrow, fully-stateless deliberation question over the
// evidence ALREADY in context:
//
//   For this claim, decompose it into per-FACET sub-queries (facet × the key entities the
//   claim is actually about) and measure which sub-queries are COVERED by the sources we
//   already hold vs. which are GAPS.
//
// A gap is not a refutation — it means the assembled evidence set does not span a clinical
// lens the claim implies (e.g. the claim asserts a mechanism but no source discusses one).
// So the vote is `neutral` when coverage is adequate and `insufficient` when a MAJOR facet
// is left uncovered — an honest "we cannot fully verify from what we have," never a forced
// directional read. Confidence is the coverage fraction.
//
// COMPOSITION CONTRACT (LAYER 3 · DELIBERATION)
//   produces: [] — deliberation/context. It writes no artifact other agents consume and casts
//     no support/refute vote; it reports a coverage map for the mix + the UI trace.
//   consumes: ["entities", "relevance"] — the whole point of the composition:
//     • scispaCy's `entities` supply the KEY biomedical entities that seed the per-facet
//       sub-queries, so the queries are grounded in the claim's actual normalized concepts
//       rather than raw claim words. (Falls back to claim tokens if the artifact is absent.)
//     • Loki's `relevance` restricts coverage to the ON-TOPIC sources (its droppedIds are
//       excluded and its per-source rank weights which sources count first), so a gap reflects
//       the sources that genuinely matter, not off-topic noise.
//   The scheduler orders autogather AFTER scispaCy + Loki. If either artifact is absent at run
//   time it degrades honestly (uses the fallback / all sources) rather than skipping outright.
//
// MOAT: fully DETERMINISTIC — same claim + entities + relevance + sources always yield the same
// sub-queries and the same coverage map. NO LLM anywhere (usedClaude is always false): this is
// pure query-generation + keyword coverage. No DB pool, no network — the offline Python twin
// backend/engines/autoresearcher-lucereal/papertrail_gather.py mirrors this same logic for
// batch/eval use. Grounded spans are only ever verbatim source substrings we actually located.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  MoaSource,
  EntityMention,
  SourceRelevance,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";

const AGENT_ID = "autogather";

// Eligibility (spec): 0.4 when at least one source exists, else 0. Coverage-gap analysis needs
// something to measure coverage against; with zero sources there is nothing to gather over.
const GATE_ELIGIBLE = 0.4;

// The clinical FACETS the claim is decomposed into — the biomedical lenses AutoResearcher would
// generate sub-queries for. Each facet carries whole-word cue terms; a source COVERS a facet
// (for a given entity) when it mentions the entity AND at least one of the facet's cues.
interface Facet {
  readonly id: string;
  // Major facets gate an `insufficient` vote when left uncovered; minor facets only lower
  // confidence. Efficacy is the core of any efficacy claim, so it is major.
  readonly major: boolean;
  readonly cues: readonly string[];
}

const FACETS: readonly Facet[] = [
  {
    id: "efficacy",
    major: true,
    cues: [
      "efficacy",
      "effective",
      "reduced",
      "reduction",
      "improved",
      "improvement",
      "response",
      "outcome",
      "endpoint",
      "hazard ratio",
      "relative risk",
      "odds ratio",
      "survival",
    ],
  },
  {
    id: "safety",
    major: false,
    cues: [
      "safety",
      "adverse",
      "toxicity",
      "tolerability",
      "side effect",
      "harm",
      "mortality",
      "serious event",
    ],
  },
  {
    id: "mechanism",
    major: false,
    cues: [
      "mechanism",
      "pathway",
      "receptor",
      "inhibit",
      "inhibition",
      "agonist",
      "antagonist",
      "binding",
      "expression",
      "signaling",
    ],
  },
  {
    id: "population",
    major: false,
    cues: [
      "population",
      "patients",
      "participants",
      "subjects",
      "cohort",
      "subgroup",
      "randomized",
      "randomised",
      "trial",
      "phase",
      "enrolled",
    ],
  },
];

// Cap how many key entities seed sub-queries and how many ids we echo, so the trace stays light.
const MAX_KEY_ENTITIES = 6;
const MAX_DETAIL_IDS = 25;
const MAX_SPANS = 4;

// A stop-word set so a claim-token fallback does not seed sub-queries from filler words.
const STOP_WORDS = new Set<string>([
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "by",
  "for",
  "to",
  "and",
  "or",
  "with",
  "was",
  "were",
  "is",
  "are",
  "be",
  "been",
  "that",
  "this",
  "than",
  "from",
  "at",
  "as",
  "it",
  "its",
  "reduced",
  "reduces",
  "increased",
  "increases",
  "percent",
]);

function hasUsableText(source: MoaSource): boolean {
  return typeof source.text === "string" && source.text.trim().length > 0;
}

function usableSourceCount(sources: readonly MoaSource[]): number {
  return sources.filter(hasUsableText).length;
}

// Normalize into a space-padded, single-spaced, alphanumeric token stream so cue/entity matches
// are whole-word (case-insensitive) runs — deterministic, no accidental substrings.
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

// A term matches when it appears as a whole-word token run inside the normalized text.
function termMatches(normalizedText: string, term: string): boolean {
  const normalizedTerm = term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalizedTerm.length === 0) return false;
  return normalizedText.includes(` ${normalizedTerm} `);
}

// The KEY entities that seed the per-facet sub-queries. Prefer scispaCy's grounded, normalized
// mentions (curie-first, deduped by surface text, stable input order) — this is the composition.
// Fall back to salient claim tokens only when no entities artifact is available.
function keyEntities(
  claim: string,
  entities: readonly EntityMention[] | undefined
): { terms: string[]; source: "entities" | "claim_tokens" } {
  if (entities !== undefined && entities.length > 0) {
    const seen = new Set<string>();
    const terms: string[] = [];
    // Grounded/normalized mentions first (curie !== null), then the rest — both in input order.
    const ordered = [
      ...entities.filter((e) => e.curie !== null),
      ...entities.filter((e) => e.curie === null),
    ];
    for (const mention of ordered) {
      const text = mention.text.trim();
      const key = text.toLowerCase();
      if (text.length === 0 || seen.has(key)) continue;
      seen.add(key);
      terms.push(text);
      if (terms.length >= MAX_KEY_ENTITIES) break;
    }
    if (terms.length > 0) return { terms, source: "entities" };
  }

  // Fallback: salient claim tokens (>=4 chars, not stop-words), deduped, first-seen order.
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of claim.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOP_WORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
    if (terms.length >= MAX_KEY_ENTITIES) break;
  }
  return { terms, source: "claim_tokens" };
}

// One generated sub-query: a facet × a key entity, and which on-topic sources cover it.
interface SubQuery {
  facet: string;
  entity: string;
  major: boolean;
  covered: boolean;
  coveredSourceIds: string[];
  matchedCue: string | null;
}

interface NormalizedSource {
  id: string;
  normalized: string;
  rawText: string;
  rank: number; // Loki relevance rank in [0,1]; 1 when no relevance artifact.
}

// Generate the deterministic sub-query grid (facet × entity) and measure coverage against the
// on-topic sources. A sub-query is covered when some source mentions BOTH the entity and one of
// the facet's cues. Sources are visited in descending relevance rank so the first cover cue is
// the most on-topic one (stable tie-break on input order via the pre-sorted list).
function generateAndCover(
  keyTerms: readonly string[],
  sources: readonly NormalizedSource[]
): SubQuery[] {
  const subQueries: SubQuery[] = [];
  for (const facet of FACETS) {
    for (const entity of keyTerms) {
      const coveredSourceIds: string[] = [];
      let matchedCue: string | null = null;
      for (const src of sources) {
        if (!termMatches(src.normalized, entity)) continue;
        const cue = facet.cues.find((c) => termMatches(src.normalized, c));
        if (cue !== undefined) {
          coveredSourceIds.push(src.id);
          if (matchedCue === null) matchedCue = cue;
        }
      }
      subQueries.push({
        facet: facet.id,
        entity,
        major: facet.major,
        covered: coveredSourceIds.length > 0,
        coveredSourceIds,
        matchedCue,
      });
    }
  }
  return subQueries;
}

// Locate a verbatim covering substring in a source's raw text for a grounded span: the exact
// matched cue term as it appears in the source (case-insensitive locate, verbatim slice).
function locateCue(rawText: string, cue: string): GroundedSpan | null {
  const idx = rawText.toLowerCase().indexOf(cue.toLowerCase());
  if (idx < 0) return null;
  return { sourceId: "", text: rawText.slice(idx, idx + cue.length), start: idx, end: idx + cue.length };
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "AutoGather Coverage-Gap",
  category: "deliberation",
  description:
    "Deliberation: decomposes the claim into per-facet sub-queries (facet × the key entities " +
    "scispaCy grounded) and measures which are covered by the on-topic sources Loki ranked vs. " +
    "which are GAPS — trusted sources only, no live fetch. Votes insufficient on a major gap, " +
    "neutral otherwise; confidence is the coverage fraction. Casts no support/refute vote.",

  // Deliberation/context: reports a coverage map; produces no consumable artifact.
  produces: [] as const,
  // Composition: seeds sub-queries from scispaCy's entities and scopes coverage to Loki's
  // on-topic relevance ranking. Scheduler orders autogather AFTER both producers.
  consumes: ["entities", "relevance"] as const,

  // ELIGIBILITY: pure + deterministic over the INPUT only (never the blackboard). 0.4 when at
  // least one source exists (there is something to measure coverage against); else 0.
  gate(ctx: OrchestrationContext): number {
    return usableSourceCount(ctx.sources) >= 1 ? GATE_ELIGIBLE : 0;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    try {
      const usable = ctx.sources.filter(hasUsableText);
      if (usable.length === 0) {
        return skippedContribution(
          AGENT_ID,
          "No usable source text — coverage-gap analysis had nothing to gather over."
        );
      }

      // COMPOSE: read the upstream artifacts.
      const entities = bb.get("entities");
      const relevance: SourceRelevance | undefined = bb.get("relevance");

      // Scope coverage to Loki's ON-TOPIC set: drop the sources it ruled off-topic, and carry
      // each survivor's rank so coverage is measured over what genuinely matters. Absent the
      // artifact, every usable source counts with a neutral rank of 1.
      const droppedIds = new Set<string>(relevance?.droppedIds ?? []);
      const rankById = relevance?.rankById ?? {};
      const onTopic: NormalizedSource[] = usable
        .filter((s) => !droppedIds.has(s.id))
        .map((s) => ({
          id: s.id,
          normalized: normalize(`${s.title ?? ""} ${s.text}`),
          rawText: s.text,
          rank: clamp01(rankById[s.id] ?? 1),
        }))
        .sort((a, b) => (b.rank !== a.rank ? b.rank - a.rank : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      // If relevance dropped every source, there is no on-topic evidence to gather over.
      if (onTopic.length === 0) {
        return skippedContribution(
          AGENT_ID,
          "Relevance ruled every source off-topic — no on-topic evidence to gather over."
        );
      }

      // Seed the sub-queries from the claim's key entities (scispaCy-grounded when available).
      const { terms: keyTerms, source: entitySource } = keyEntities(ctx.claim, entities);
      if (keyTerms.length === 0) {
        return skippedContribution(
          AGENT_ID,
          "No key entities or salient claim tokens to seed sub-queries."
        );
      }

      const subQueries = generateAndCover(keyTerms, onTopic);

      const total = subQueries.length;
      const covered = subQueries.filter((q) => q.covered);
      const gaps = subQueries.filter((q) => !q.covered);
      const coverageFraction = clamp01(total > 0 ? covered.length / total : 0);

      // A MAJOR gap is an uncovered major-facet sub-query — the honest trigger for `insufficient`.
      const majorGaps = gaps.filter((q) => q.major);
      const signal = majorGaps.length > 0 ? "insufficient" : "neutral";

      // Grounded spans: the verbatim covering cue substrings from the top covered sub-queries,
      // stamped with the real source id. Never fabricated — located in the source's own text.
      const rawById = new Map(onTopic.map((s) => [s.id, s.rawText] as const));
      const groundedSpans: GroundedSpan[] = [];
      for (const q of covered) {
        if (groundedSpans.length >= MAX_SPANS) break;
        if (q.matchedCue === null) continue;
        const firstId = q.coveredSourceIds[0];
        if (firstId === undefined) continue;
        const rawText = rawById.get(firstId);
        if (rawText === undefined) continue;
        const span = locateCue(rawText, q.matchedCue);
        if (span !== null) groundedSpans.push({ ...span, sourceId: firstId });
      }

      const summary =
        gaps.length === 0
          ? `All ${total} generated sub-queries (facet × entity) covered by ${onTopic.length} on-topic source(s).`
          : majorGaps.length > 0
            ? `${covered.length}/${total} sub-queries covered; MAJOR coverage gap on ` +
              `${[...new Set(majorGaps.map((q) => q.facet))].join(", ")} — cannot fully verify from the sources held.`
            : `${covered.length}/${total} sub-queries covered; minor gap on ` +
              `${[...new Set(gaps.map((q) => q.facet))].join(", ")}.`;

      return makeContribution(AGENT_ID, {
        ran: true,
        signal,
        confidence: coverageFraction,
        summary,
        detail: {
          // The generated grid + the coverage measurement (spec: subQueries, covered, gaps).
          subQueries: subQueries.map((q) => ({
            facet: q.facet,
            entity: q.entity,
            major: q.major,
            covered: q.covered,
            coveredSourceIds: q.coveredSourceIds.slice(0, MAX_DETAIL_IDS),
            coveredSourceIdsTruncated: q.coveredSourceIds.length > MAX_DETAIL_IDS,
            matchedCue: q.matchedCue,
          })),
          covered: covered.map((q) => ({ facet: q.facet, entity: q.entity })),
          gaps: gaps.map((q) => ({ facet: q.facet, entity: q.entity, major: q.major })),
          totalSubQueries: total,
          coveredCount: covered.length,
          gapCount: gaps.length,
          majorGapCount: majorGaps.length,
          coverageFraction,
          // Composition provenance: what upstream artifacts autogather actually consumed.
          keyEntities: keyTerms,
          entitySeedSource: entitySource,
          entitiesProducer: bb.producerOf("entities") ?? null,
          relevanceProducer: bb.producerOf("relevance") ?? null,
          onTopicSourceCount: onTopic.length,
          droppedOffTopicCount: droppedIds.size,
        },
        groundedSpans,
        usedClaude: false,
        // Deliberation/context: no consumable artifact produced.
        produced: {},
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
