// END-TO-END EVIDENCE PIPELINE — the product's core promise in one call: a claim
// goes IN, a full composite evidence report comes OUT, having found its own primary
// sources. This is the seam that turns PaperTrail from "paste your own effect sizes"
// into "give me a claim and I'll go find the trials and rate them."
//
// The chain is:
//   1. RETRIEVE candidate CACHED sources relevant to the claim (semantic search over
//      the sources table, via lib/agents/retrievalAgent). Retrieval/embedding is the
//      ONLY place a model touches this flow — and it never produces a number.
//   2. SYNTHESISE deterministically: hand the retrieved rows to autoSynthesize, which
//      rule-extracts each source's primary ratio effect (registered CT.gov results or
//      parsed PubMed text) and pools them via buildEvidenceReport
//      (meta-analysis → publication-bias → GRADE → verdict). NO LLM in the numeric loop.
//
// Honesty rule (CLAUDE.md): when retrieval + extraction yield fewer than two poolable
// studies, we return an honest insufficient result carrying WHICH sources were used
// and WHY the rest were skipped — never a forced low-confidence pool. A wrong
// "confident" answer is worse than an admitted "couldn't verify."
//
// Retrieval is INJECTABLE so tests can run the full pipeline with fixture sources and
// no live embeddings / DB. This file performs no direct DB or network I/O of its own;
// all of that lives behind the injected retriever.

import type { Pool } from "pg";
import { z } from "zod";
import { retrieveSources } from "./agents/retrievalAgent";
import type { SourceCandidate } from "./schemas";
import {
  autoSynthesize,
  type AutoSynthesisSource,
  type SkippedSource,
} from "./autoSynthesis";
import type { BuildEvidenceReportResult } from "./evidenceReport";

// ---------------------------------------------------------------------------
// Input. Boundary-validated so a route can hand raw JSON straight in. `claim`
// drives retrieval when no explicit `query` is given; `query` lets a caller steer
// the semantic search independently of the claim wording. `limit` caps how many
// candidate sources retrieval may return (retrieval applies its own hard ceiling).
// ---------------------------------------------------------------------------
export const EvidencePipelineInputSchema = z.object({
  claim: z.string().trim().min(10).max(2000),
  query: z.string().trim().min(1).max(2000).optional(),
  limit: z.number().int().positive().max(20).optional(),
});
export type EvidencePipelineInput = z.infer<typeof EvidencePipelineInputSchema>;

// A retriever takes the search text and returns cached source candidates, best-match
// first. The default is the real semantic retrieval agent; tests inject a stub. It is
// intentionally the SourceCandidate shape so the production retriever slots in directly.
export type SourceRetriever = (query: string) => Promise<SourceCandidate[]>;

// One source that actually contributed (was retrieved) to the report — the citation
// trail. `skipped` sources appear separately with their reason.
export interface UsedSource {
  id: string;
  title: string | null;
  source_type: string;
}

export interface EvidencePipelineResult {
  claim: string;
  usedSources: UsedSource[];
  skipped: SkippedSource[];
  report: BuildEvidenceReportResult;
}

// Adapt a retrieved SourceCandidate into the structural AutoSynthesisSource the
// deterministic synthesiser consumes. Pure: builds a new object, mutates nothing.
function toSynthesisSource(candidate: SourceCandidate): AutoSynthesisSource {
  return {
    id: candidate.id,
    source_type: candidate.source_type,
    title: candidate.title ?? null,
    raw_text: candidate.raw_text ?? "",
    registered_results: candidate.registered_results ?? null,
  };
}

function toUsedSource(candidate: SourceCandidate): UsedSource {
  return {
    id: candidate.id,
    title: candidate.title ?? null,
    source_type: candidate.source_type,
  };
}

// The honest "we couldn't assemble a body of evidence" report, in the same shape as an
// InsufficientEvidenceReport from buildEvidenceReport — so downstream consumers handle
// it uniformly. Used when retrieval finds zero (or too few) candidate sources, before
// any pooling is even attempted.
function insufficientReport(
  claim: string,
  usableStudies: number,
  reason: string
): BuildEvidenceReportResult {
  return {
    ok: false,
    claim,
    reason,
    claimedReductionPercent: null,
    usableStudies,
    skipped: [],
  };
}

/**
 * Run the full claim-to-evidence-report pipeline.
 *
 * Retrieves cached primary sources relevant to the claim (or explicit `query`), then
 * deterministically extracts and pools their primary ratio effects into a composite
 * evidence report. Returns the report plus the citation trail: which sources were used
 * and which were skipped (with reasons). When fewer than two usable sources are found,
 * returns an honest insufficient result rather than forcing a low-confidence pool —
 * mirroring the `no_support_found` spirit.
 *
 * Retrieval is injectable (`opts.retrieve`) so callers/tests can supply fixture sources
 * without live embeddings or a DB. The default retriever is the real semantic agent,
 * which reads ONLY the cached `sources` table (never re-fetching what is cached).
 *
 * Pure orchestration over the retriever + synthesiser: NO LLM in any numeric step, and
 * this function performs no direct DB/network I/O of its own.
 */
export async function runEvidencePipeline(
  pool: Pool,
  input: EvidencePipelineInput,
  opts?: { retrieve?: SourceRetriever }
): Promise<EvidencePipelineResult> {
  const parsed = EvidencePipelineInputSchema.parse(input);
  const claim = parsed.claim;
  const searchText = parsed.query ?? claim;

  // Default retriever reads cached sources via the semantic agent. `pool` is threaded
  // for symmetry with the org-scoped/compute route conventions and so an injected
  // retriever can close over it if it needs direct DB access; the default agent uses
  // the shared pool internally.
  const retrieve: SourceRetriever = opts?.retrieve ?? ((q) => retrieveSources(q));

  const candidatesRaw = await retrieve(searchText);
  const limit = parsed.limit;
  const candidates =
    typeof limit === "number" ? candidatesRaw.slice(0, limit) : candidatesRaw;

  // Zero confident matches: honest "no support found" — retrieval couldn't ground the
  // claim in any cached primary source, so there is nothing to synthesise.
  if (candidates.length === 0) {
    return {
      claim,
      usedSources: [],
      skipped: [],
      report: insufficientReport(
        claim,
        0,
        "No confident matching primary source was retrieved for this claim, so there is no body of evidence to pool. This is reported honestly rather than forcing a low-confidence match against an unrelated source."
      ),
    };
  }

  // Deterministic extraction + pooling. autoSynthesize itself returns an honest
  // insufficient report (with per-source skip reasons) when fewer than two sources
  // yield a poolable ratio effect — no forced low-confidence pool.
  const synthesis = autoSynthesize({
    claim,
    sources: candidates.map(toSynthesisSource),
  });

  return {
    claim,
    usedSources: candidates.map(toUsedSource),
    skipped: synthesis.skipped,
    report: synthesis.report,
  };
}

// ===========================================================================
// EVIDENCE-SUFFICIENCY GATE — ADDITIVE deterministic loop control.
//
// Retrieval + RAG-Fusion answer "did we find the right sources?". This gate
// answers the other half: "do we have ENOUGH grounded evidence to conclude, or
// should we run another retrieval pass?". It is DETERMINISTIC — no LLM — and
// decides purely by field-standard thresholds over numbers the deterministic
// engines already produced (pooled study count, participant total, I²) plus a
// contradiction-resolution flag the caller supplies.
//
// Thresholds (mirroring backend/engines/R2R/PAPERTRAIL.md):
//   - at least 3 pooled studies
//   - total participants >= 100
//   - heterogeneity I² < 75%
//   - contradictions resolved (none open)
//
// It never concludes on its own — it returns { sufficient, reasons } so the
// caller can decide to synthesise (sufficient) or widen retrieval (insufficient).
// This block adds new exports ONLY; it does not change runEvidencePipeline or any
// existing export. Pure: no I/O, no mutation.
// ===========================================================================

// Field-standard sufficiency thresholds. Named constants (no magic numbers) so a
// reviewer can audit exactly what "enough evidence" means here.
export const MIN_STUDIES = 3;
export const MIN_PARTICIPANTS = 100;
export const MAX_I_SQUARED = 75; // percent

// Structural input to the gate. Kept decoupled from any DB row / report internals
// so a route can assemble it from an EvidencePipelineResult plus the source rows'
// enrollment counts and an open-contradiction count. Every field is explicit.
export interface EvidenceSufficiencyInput {
  // Number of studies that actually pooled (e.g. report.pooled.k, or the count of
  // extracted studies). NOT the number of sources retrieved.
  pooledStudies: number;
  // Sum of participants across the pooled studies (e.g. Σ enrollment_count).
  totalParticipants: number;
  // Pooled heterogeneity I² in percent (e.g. report.pooled.heterogeneity.iSquared).
  // Null when it could not be computed (fewer than the studies needed) — treated
  // as a failed criterion, since un-assessable heterogeneity is not "< 75%".
  iSquared: number | null;
  // Count of contradictions between sources that remain OPEN (unresolved). 0 means
  // all detected contradictions have been resolved (or none were detected).
  openContradictions: number;
}

export interface EvidenceSufficiencyResult {
  sufficient: boolean;
  reasons: string[];
  // Per-criterion detail so the caller can render exactly what passed/failed.
  criteria: {
    enoughStudies: boolean;
    enoughParticipants: boolean;
    acceptableHeterogeneity: boolean;
    contradictionsResolved: boolean;
  };
}

/**
 * Deterministic evidence-sufficiency gate: decide whether a synthesis has enough
 * grounded evidence to conclude, or needs another retrieval pass.
 *
 * Evaluates four field-standard criteria — at least 3 pooled studies, >= 100 total
 * participants, I² < 75%, and all contradictions resolved — and returns
 * `sufficient` (all pass) plus a `reasons` array naming exactly which criteria
 * failed. NO LLM: purely thresholds over numbers the deterministic engines already
 * produced. When `sufficient` is false the caller should widen retrieval (e.g. run
 * another RAG-Fusion pass) rather than concluding on thin evidence — the house rule
 * that an honest "insufficient" beats a forced low-confidence verdict. Pure: no I/O,
 * does not mutate its input.
 */
export function evidenceSufficiency(
  input: EvidenceSufficiencyInput
): EvidenceSufficiencyResult {
  const reasons: string[] = [];

  const enoughStudies = input.pooledStudies >= MIN_STUDIES;
  if (!enoughStudies) {
    reasons.push(
      `Only ${input.pooledStudies} pooled ${
        input.pooledStudies === 1 ? "study" : "studies"
      } — at least ${MIN_STUDIES} are needed to conclude.`
    );
  }

  const enoughParticipants = input.totalParticipants >= MIN_PARTICIPANTS;
  if (!enoughParticipants) {
    reasons.push(
      `Only ${input.totalParticipants} total participants — at least ${MIN_PARTICIPANTS} are needed to conclude.`
    );
  }

  // Un-assessable heterogeneity (null) is NOT treated as acceptable: we cannot
  // assert I² < 75% when I² is unknown, so the criterion honestly fails.
  const acceptableHeterogeneity =
    input.iSquared !== null && input.iSquared < MAX_I_SQUARED;
  if (!acceptableHeterogeneity) {
    reasons.push(
      input.iSquared === null
        ? `Heterogeneity (I²) could not be assessed — it must be below ${MAX_I_SQUARED}% to conclude.`
        : `Heterogeneity is high (I²=${input.iSquared}%) — it must be below ${MAX_I_SQUARED}% to conclude.`
    );
  }

  const contradictionsResolved = input.openContradictions <= 0;
  if (!contradictionsResolved) {
    reasons.push(
      `${input.openContradictions} unresolved ${
        input.openContradictions === 1 ? "contradiction" : "contradictions"
      } between sources — resolve them before concluding.`
    );
  }

  const sufficient =
    enoughStudies &&
    enoughParticipants &&
    acceptableHeterogeneity &&
    contradictionsResolved;

  return {
    sufficient,
    reasons,
    criteria: {
      enoughStudies,
      enoughParticipants,
      acceptableHeterogeneity,
      contradictionsResolved,
    },
  };
}
