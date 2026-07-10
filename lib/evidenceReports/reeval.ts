// LIVING-EVIDENCE RE-EVALUATION — re-run a SAVED evidence report's pipeline against
// the CURRENT cached sources and report whether its conclusion has changed. The point
// is honesty over time: a report saved last week may silently go stale as new trials
// are ingested, and a conclusion nobody re-checked is a conclusion nobody can trust.
// This module answers one question — "does the saved verdict/certainty still hold
// against everything we've cached since?" — and reports the delta, nothing more.
//
// It performs no direct DB or network I/O of its own. The two boundaries are:
//   1. getReport (org-scoped) — loads the saved report; null if missing / other tenant.
//   2. an INJECTABLE pipeline runner (default = runEvidencePipeline) — re-derives a
//      fresh report for the same claim. Injectable so tests run with a stub instead of
//      live retrieval / embeddings / DB.
// The diff itself is pure: it never mutates the stored record or the fresh result.
//
// NO LLM in the numeric loop — the diff compares deterministic engine outputs
// (verdict, GRADE certainty, pooled study count k) that trace back to the sources.

import type { Pool } from "pg";
import { getReport } from "./repository";
import type { EvidenceReportRecord } from "./types";
import {
  runEvidencePipeline,
  type EvidencePipelineResult,
} from "@/lib/evidencePipeline";
import type { BuildEvidenceReportResult } from "@/lib/evidenceReport";

// The three comparable dimensions of a conclusion. Kept deliberately small: these are
// the fields a reviewer scans first ("what did it decide, how sure was it, on how many
// trials"). `verdict` and `certainty` are null when the report was insufficient (no
// pool). `k` is the number of pooled studies (0 when insufficient).
export interface ReportSummary {
  verdict: string | null;
  certainty: string | null;
  k: number;
}

export interface ReevalDelta {
  verdictChanged: boolean;
  certaintyChanged: boolean;
  kDelta: number;
}

export interface ReevalResult {
  changed: boolean;
  previous: ReportSummary;
  current: ReportSummary;
  delta: ReevalDelta;
  freshReport: EvidencePipelineResult;
}

// A pipeline runner has the exact shape of runEvidencePipeline so the production
// function slots in as the default and a test can inject a stub. `opts` is threaded
// through untouched (e.g. an injected retriever in the real pipeline).
export type PipelineRunner = (
  pool: Pool,
  input: { claim: string; query?: string; limit?: number },
  opts?: Parameters<typeof runEvidencePipeline>[2]
) => Promise<EvidencePipelineResult>;

export interface ReevaluateInput {
  orgId: string;
  reportId: string;
}

export interface ReevaluateOptions {
  // Injectable pipeline runner. Defaults to the real end-to-end pipeline, which
  // reads ONLY cached sources. Tests inject a stub whose fresh verdict differs from
  // the stored one to exercise the diff without live retrieval.
  runPipeline?: PipelineRunner;
  // Forwarded to the pipeline runner (e.g. a fixture retriever in tests). Never
  // carries a client-supplied org_id — org scoping happens via getReport above.
  pipelineOpts?: Parameters<typeof runEvidencePipeline>[2];
}

// ---------------------------------------------------------------------------
// Pure summarizers. Each collapses a full report object into the three comparable
// dimensions. Isolated and side-effect-free so the diff is trivially testable.
// ---------------------------------------------------------------------------

// Read a numeric pooled-study count `k` out of an opaque stored `report` jsonb.
// A saved report's jsonb is the full pipeline/engine object; when it pooled, k lives
// at report.pooled.k. We narrow defensively — the column is opaque at this layer —
// and fall back to 0 (treated as "insufficient / not pooled") when absent.
function kFromStoredReport(report: EvidenceReportRecord["report"]): number {
  const pooled = (report as { pooled?: unknown }).pooled;
  if (pooled !== null && typeof pooled === "object") {
    const k = (pooled as { k?: unknown }).k;
    if (typeof k === "number" && Number.isFinite(k)) {
      return k;
    }
  }
  return 0;
}

// Summarize the STORED record. Prefers the denormalized verdict/certainty columns
// (what was persisted at save time — the source of truth for the saved conclusion),
// and derives k from the stored report jsonb.
export function summarizeStored(record: EvidenceReportRecord): ReportSummary {
  return {
    verdict: record.verdict,
    certainty: record.certainty,
    k: kFromStoredReport(record.report),
  };
}

// Summarize a FRESH BuildEvidenceReportResult. When ok, the verdict is the synthesis
// verdict, the certainty is the GRADE rating, and k is the pooled study count. When
// insufficient (ok:false), there is no verdict/certainty and k is the usable-study
// count — mirroring the honest-insufficient contract the engine already returns.
export function summarizeFresh(report: BuildEvidenceReportResult): ReportSummary {
  if (report.ok) {
    return {
      verdict: report.verdict.verdict,
      certainty: report.certainty.certainty,
      k: report.pooled.k,
    };
  }
  return {
    verdict: null,
    certainty: null,
    k: report.usableStudies,
  };
}

// Pure diff of two summaries. `changed` is the OR of all three dimensions so a caller
// can branch on a single boolean, while `delta` preserves per-dimension detail.
export function diffSummaries(
  previous: ReportSummary,
  current: ReportSummary
): { changed: boolean; delta: ReevalDelta } {
  const delta: ReevalDelta = {
    verdictChanged: previous.verdict !== current.verdict,
    certaintyChanged: previous.certainty !== current.certainty,
    kDelta: current.k - previous.k,
  };
  const changed =
    delta.verdictChanged || delta.certaintyChanged || delta.kDelta !== 0;
  return { changed, delta };
}

/**
 * Re-evaluate a saved evidence report against the current cached sources.
 *
 * Loads the org-scoped saved report (returns null if it does not exist or belongs to
 * another tenant), re-runs the evidence pipeline for its claim via an injectable
 * runner, and diffs the fresh conclusion against the stored one across verdict,
 * GRADE certainty, and pooled study count. Returns the diff plus the full fresh
 * report so a caller can present or persist the updated conclusion.
 *
 * Pure orchestration over getReport + the injected runner: no direct DB/network I/O
 * here, no mutation of the stored record or fresh result, and NO LLM in the numeric
 * comparison — every compared value is a deterministic engine output.
 */
export async function reevaluateReport(
  pool: Pool,
  input: ReevaluateInput,
  opts?: ReevaluateOptions
): Promise<ReevalResult | null> {
  const record = await getReport(pool, input.orgId, input.reportId);
  if (!record) {
    return null;
  }

  const runPipeline: PipelineRunner = opts?.runPipeline ?? runEvidencePipeline;
  const freshReport = await runPipeline(
    pool,
    { claim: record.claim },
    opts?.pipelineOpts
  );

  const previous = summarizeStored(record);
  const current = summarizeFresh(freshReport.report);
  const { changed, delta } = diffSummaries(previous, current);

  return { changed, previous, current, delta, freshReport };
}
