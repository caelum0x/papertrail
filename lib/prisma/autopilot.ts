// PRISMA SYSTEMATIC-REVIEW AUTOPILOT — orchestrate a WHOLE review from a question.
//
// One call takes a research question + inclusion criteria and drives the full PRISMA
// flow, chaining EXISTING PaperTrail engines end to end:
//
//   1. IDENTIFY  — gather candidate records: either search+cache live literature
//                  (lib/ingest searchAndCache → cached `sources` rows) or use an
//                  explicitly pinned set of already-cached source_ids.
//   2. DEDUPE    — remove duplicate candidate ids before any Claude work.
//   3. SCREEN    — AI title/abstract screening with lib/screening aiRankRecords:
//                  Claude scores each candidate 0..1 against the criteria and writes
//                  a rationale grounded in that record's own abstract. Records at/above
//                  the include threshold are INCLUDED; the rest EXCLUDED. (Heavy,
//                  high-volume Claude: per-abstract relevance reasoning over many records.)
//   4. EXTRACT   — for each INCLUDED record, lib/extraction extractPaper reads the FULL
//                  text and returns grounded PICO + effect sizes (every number tied to an
//                  exact source span; ungroundable effects dropped). (Heavy Claude:
//                  long-context structured extraction per included paper.)
//   5. SYNTHESISE— pool the included evidence into ONE composite report via
//                  lib/evidencePipeline runEvidencePipeline (retrieval →
//                  autoSynthesize → buildEvidenceReport: meta-analysis → publication-bias
//                  → GRADE → verdict). NO LLM in the numeric loop.
//
// TRUST LAYER (why this heavy, high-volume Claude use is safe): screening rationales are
// grounded against each record's own abstract by aiRank; extracted effects are grounded
// to exact spans of raw_text and reconciled by extractPaper; and the final synthesis is
// entirely deterministic. Every factual/numeric claim Claude produces is verified by an
// existing engine before it reaches the report — the model fans out, the engines vouch.
//
// Everything that touches the network / DB / Claude is INJECTABLE (see AutopilotDeps) so
// the whole orchestration runs OFFLINE in tests with deterministic stubs. This file
// imports existing modules and never edits them. It never logs question/criteria text.

import type { Pool } from "pg";
import { searchAndCache } from "../ingest/searchAndCache";
import { aiRankRecords } from "../screening/aiRank";
import type { RankableRecord, RankedRecord } from "../screening/schemas";
import { extractPaper, type PaperSourceMeta } from "../extraction/paperExtract";
import type { PaperExtractResult } from "../extraction/schemas";
import { runEvidencePipeline } from "../evidencePipeline";
import type { EvidencePipelineResult } from "../evidencePipeline";
import type { SourceCandidate } from "../schemas";
import {
  PrismaAutopilotInputSchema,
  type PrismaAutopilotInput,
  type PrismaFlowCounts,
  type ScreenedRecordSummary,
  type ExtractedRecordSummary,
} from "./schemas";

// Default relevance threshold at/above which a screened record is included. 0.5 is the
// neutral midpoint — a record the model judges "more likely relevant than not" is carried
// forward. Overridable per call so a reviewer can widen or tighten the net.
const DEFAULT_INCLUDE_THRESHOLD = 0.5;

// Columns for a cached `sources` row hydrated into a SourceCandidate. Kept identical to
// the columns retrievalAgent selects so the pinned-ids path yields the same shape the
// rest of the pipeline expects (we do NOT invent a new source schema here).
const SOURCE_COLUMNS =
  "id, source_type, external_id, title, raw_text, url, phase, enrollment_count, registered_results";

// ---------------------------------------------------------------------------
// Injectable dependencies. Defaults wire the real engines; tests pass stubs so the
// full flow runs with no network, DB, embeddings, or live Claude.
// ---------------------------------------------------------------------------
export interface AutopilotDeps {
  // Live ingestion: search+cache literature for the question, returns cached ids.
  searchAndCache: (
    pool: Pool,
    params: { query: string; limit?: number }
  ) => Promise<{ cachedSourceIds: string[]; fetchedCount: number; reusedCount: number }>;
  // Hydrate cached `sources` rows into SourceCandidates by id (order not guaranteed).
  loadSourcesByIds: (pool: Pool, ids: readonly string[]) => Promise<SourceCandidate[]>;
  // AI title/abstract screening (Claude, grounded rationales).
  aiRankRecords: (params: {
    criteria: string[];
    records: RankableRecord[];
  }) => Promise<{ ranked: RankedRecord[]; unrankedIds: string[] }>;
  // Full-paper structured extraction (Claude, grounded effects).
  extractPaper: (rawText: string, source?: PaperSourceMeta) => Promise<PaperExtractResult>;
  // Deterministic synthesis over the included sources.
  runEvidencePipeline: (
    pool: Pool,
    input: { claim: string; query?: string; limit?: number },
    opts?: { retrieve?: (query: string) => Promise<SourceCandidate[]> }
  ) => Promise<EvidencePipelineResult>;
}

// Real-engine defaults. searchAndCache/runEvidencePipeline are passed through with their
// exact signatures; loadSourcesByIds is the one small DB read this module needs.
export const defaultAutopilotDeps: AutopilotDeps = {
  searchAndCache: (pool, params) => searchAndCache(pool, params),
  loadSourcesByIds,
  aiRankRecords: (params) => aiRankRecords(params),
  extractPaper: (rawText, source) => extractPaper(rawText, source),
  runEvidencePipeline: (pool, input, opts) => runEvidencePipeline(pool, input, opts),
};

/**
 * Hydrate cached `sources` rows into SourceCandidates by id. Parameterized single query;
 * returns only the rows that exist (missing ids simply don't appear). Never logs text.
 */
async function loadSourcesByIds(
  pool: Pool,
  ids: readonly string[]
): Promise<SourceCandidate[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `select ${SOURCE_COLUMNS} from sources where id = any($1::uuid[])`,
    [Array.from(ids)]
  );
  return rows as SourceCandidate[];
}

/** Adapt a cached SourceCandidate into the {id,title,abstract} record aiRank screens. */
function toRankableRecord(source: SourceCandidate): RankableRecord {
  return {
    id: source.id,
    title: source.title ?? "(untitled source)",
    // raw_text is the abstract/summary for PubMed + the trial summary for CT.gov —
    // exactly the title/abstract signal aiRank grounds each rationale against.
    abstract: source.raw_text ?? null,
  };
}

// ---------------------------------------------------------------------------
// Result. The PRISMA-flow summary a reviewer / the console renders: per-stage record
// summaries, the flow counts for a PRISMA diagram, the grounded per-record extractions,
// and the single composite evidence report over the INCLUDED body of evidence.
// ---------------------------------------------------------------------------
export interface PrismaAutopilotResult {
  question: string;
  criteria: string[];
  counts: PrismaFlowCounts;
  // Every screened record with its include/exclude decision + grounded rationale.
  screened: ScreenedRecordSummary[];
  // Per-included-record extraction roll-up (grounded effect counts).
  extractedRecords: ExtractedRecordSummary[];
  // The full grounded extractions for included records (PICO + effects + provenance).
  extractedEffects: PaperExtractResult[];
  // The composite evidence report over the included sources (meta-analysis → GRADE →
  // verdict), or the honest insufficient report when < 2 poolable studies. Null only
  // when nothing was included (no body of evidence to synthesise).
  report: EvidencePipelineResult["report"] | null;
  // Which included sources actually contributed to the synthesised report, and which
  // were skipped (with reasons) — the citation trail.
  synthesis: {
    usedSources: EvidencePipelineResult["usedSources"];
    skipped: EvidencePipelineResult["skipped"];
  } | null;
}

/**
 * Run the entire PRISMA systematic review from a question.
 *
 * Gathers candidates (search+cache or pinned ids) → dedupes → AI-screens each against the
 * inclusion criteria → extracts grounded effects from every included record → synthesises
 * the included body of evidence into one composite report. Returns a PRISMA-flow summary
 * plus the counts for a PRISMA diagram.
 *
 * Heavy, high-volume Claude across screening + extraction; the deterministic engines
 * ground every rationale and every number and pool the result with no LLM in the numeric
 * loop. Retrieval/Claude are injectable (`deps`) so the whole flow tests offline.
 *
 * Pure orchestration over the injected engines: it performs no direct network I/O of its
 * own beyond the one cached-row read (also injected), and never mutates its inputs.
 */
export async function runPrismaAutopilot(
  pool: Pool,
  input: PrismaAutopilotInput,
  deps: AutopilotDeps = defaultAutopilotDeps
): Promise<PrismaAutopilotResult> {
  const parsed = PrismaAutopilotInputSchema.parse(input);
  const question = parsed.question;
  const criteria = parsed.criteria;
  const includeThreshold = parsed.include_threshold ?? DEFAULT_INCLUDE_THRESHOLD;

  // --- 1. IDENTIFY + 2. DEDUPE -------------------------------------------------------
  // Resolve the candidate cached-source ids, deduped. Two mutually exclusive paths:
  //   - pinned source_ids: review exactly these (reproducible / "review THESE").
  //   - no ids: search+cache live literature for the question (bounded by limit).
  let candidateIds: string[];
  if (parsed.source_ids && parsed.source_ids.length > 0) {
    candidateIds = parsed.source_ids;
  } else {
    const ingest = await deps.searchAndCache(pool, {
      query: question,
      limit: parsed.limit,
    });
    candidateIds = ingest.cachedSourceIds;
  }

  const identified = candidateIds.length;
  const dedupedIds = Array.from(new Set(candidateIds));
  const duplicatesRemoved = identified - dedupedIds.length;

  // Hydrate the deduped ids into full SourceCandidates for screening + extraction.
  // Missing rows (a pinned id with no cached row) simply drop out here.
  const sources = await deps.loadSourcesByIds(pool, dedupedIds);
  const sourcesById = new Map(sources.map((s) => [s.id, s]));

  // Nothing to review: return an honest empty PRISMA flow rather than a forced result.
  if (sources.length === 0) {
    return emptyResult(question, criteria, { identified, duplicatesRemoved });
  }

  // --- 3. SCREEN (heavy Claude) ------------------------------------------------------
  const { ranked } = await deps.aiRankRecords({
    criteria,
    records: sources.map(toRankableRecord),
  });

  const screened: ScreenedRecordSummary[] = [];
  const includedSources: SourceCandidate[] = [];
  const rankedIds = new Set<string>();

  for (const r of ranked) {
    rankedIds.add(r.id);
    const decision: ScreenedRecordSummary["decision"] =
      r.relevance >= includeThreshold ? "included" : "excluded";
    screened.push({
      id: r.id,
      title: r.title,
      relevance: r.relevance,
      decision,
      rationale: r.rationale,
      groundingOk: r.groundingOk,
    });
    if (decision === "included") {
      const src = sourcesById.get(r.id);
      if (src) includedSources.push(src);
    }
  }

  // A record the screener returned no verdict for is treated as excluded honestly (an
  // unranked record was never judged relevant — never silently included).
  for (const s of sources) {
    if (rankedIds.has(s.id)) continue;
    screened.push({
      id: s.id,
      title: s.title ?? "(untitled source)",
      relevance: 0,
      decision: "excluded",
      rationale: "The screener returned no relevance verdict for this record; excluded rather than assumed relevant.",
      groundingOk: false,
    });
  }

  const includedCount = includedSources.length;
  const excludedCount = screened.length - includedCount;

  // --- 4. EXTRACT (heavy Claude, grounded) -------------------------------------------
  // Long-context structured extraction per included record, run concurrently. Each
  // returns grounded PICO + effects; a single record's failure must not sink the review.
  const extractionResults = await Promise.all(
    includedSources.map(async (src) => {
      try {
        const result = await deps.extractPaper(src.raw_text ?? "", {
          id: src.id,
          title: src.title ?? null,
          external_id: src.external_id ?? null,
          source_type: src.source_type ?? null,
          url: src.url ?? null,
        });
        return result;
      } catch {
        // Extraction failed for this record — skip it, keep the review going.
        return null;
      }
    })
  );

  const extractedEffects: PaperExtractResult[] = [];
  const extractedRecords: ExtractedRecordSummary[] = [];
  for (let i = 0; i < includedSources.length; i += 1) {
    const src = includedSources[i];
    const res = extractionResults[i];
    if (!res) continue;
    extractedEffects.push(res);
    extractedRecords.push({
      id: src.id,
      title: src.title ?? "(untitled source)",
      groundedEffectCount: res.effects.length,
      droppedEffectCount: res.ungrounded_dropped_count,
    });
  }

  const extractedWithEffects = extractedRecords.filter((r) => r.groundedEffectCount > 0).length;

  // --- 5. SYNTHESISE (deterministic) -------------------------------------------------
  // Pool the INCLUDED body of evidence into one composite report. We drive
  // runEvidencePipeline with an injected retriever that returns exactly the included
  // sources — so the synthesis operates on the screened-in set, not a fresh semantic
  // search. The pipeline's own honesty rule handles < 2 poolable studies.
  let report: PrismaAutopilotResult["report"] = null;
  let synthesis: PrismaAutopilotResult["synthesis"] = null;
  if (includedSources.length > 0) {
    const included = includedSources;
    const pipeline = await deps.runEvidencePipeline(
      pool,
      { claim: question },
      { retrieve: async () => included }
    );
    report = pipeline.report;
    synthesis = { usedSources: pipeline.usedSources, skipped: pipeline.skipped };
  }

  const counts: PrismaFlowCounts = {
    identified,
    duplicatesRemoved,
    screened: sources.length,
    excluded: excludedCount,
    included: includedCount,
    extractedWithEffects,
  };

  return {
    question,
    criteria,
    counts,
    screened,
    extractedRecords,
    extractedEffects,
    report,
    synthesis,
  };
}

/** Honest empty PRISMA flow when no reviewable source rows were resolved. */
function emptyResult(
  question: string,
  criteria: string[],
  partial: { identified: number; duplicatesRemoved: number }
): PrismaAutopilotResult {
  return {
    question,
    criteria,
    counts: {
      identified: partial.identified,
      duplicatesRemoved: partial.duplicatesRemoved,
      screened: 0,
      excluded: 0,
      included: 0,
      extractedWithEffects: 0,
    },
    screened: [],
    extractedRecords: [],
    extractedEffects: [],
    report: null,
    synthesis: null,
  };
}
