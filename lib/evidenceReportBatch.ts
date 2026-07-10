// BATCH evidence reporting — run buildEvidenceReport across many claim+study
// sets in one call and reduce each to a compact, comparable row. Pure and
// deterministic: no LLM anywhere, no mutation of inputs. One malformed item
// never aborts the batch — its error is captured on the row and the run
// continues, so a reviewer screening a spreadsheet of claims gets a result for
// every row (or an honest error for the ones that failed).
//
// Owns ONLY the batch + CSV concern. Every number still comes from the existing
// deterministic engines via buildEvidenceReport; this file summarizes them.

import { z } from "zod";
import {
  buildEvidenceReport,
  EvidenceReportStudySchema,
} from "./evidenceReport";
import { toCsv } from "./csvExport";

// ---------------------------------------------------------------------------
// Request schema. A batch of 1..50 items, each an optional id plus the same
// claim + studies payload the single evidence-report endpoint accepts. The id
// lets callers correlate rows back to their own records; when omitted we fall
// back to the item's ordinal index so every row is still identifiable.
// ---------------------------------------------------------------------------
export const BatchItemSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  claim: z.string().trim().min(10).max(2000),
  studies: z.array(EvidenceReportStudySchema).min(1).max(100),
  risk_of_bias_steps: z.number().int().min(0).max(2).optional(),
  indirectness_steps: z.number().int().min(0).max(2).optional(),
});
export type BatchItem = z.infer<typeof BatchItemSchema>;

export const BatchRequestSchema = z.object({
  items: z.array(BatchItemSchema).min(1).max(50),
});
export type BatchRequest = z.infer<typeof BatchRequestSchema>;

// ---------------------------------------------------------------------------
// Result shape. One compact row per input item, in input order. `error` is set
// only when buildEvidenceReport threw for that item; otherwise the statistical
// fields carry the summary. `verdict` is "insufficient_evidence" for honest
// under-two-study rows, mirroring the single-report contract.
// ---------------------------------------------------------------------------
export interface EvidenceReportBatchRow {
  id: string;
  verdict: string;
  certainty: string | null;
  pooledPoint: number | null;
  pooledCiLower: number | null;
  pooledCiUpper: number | null;
  iSquared: number | null;
  publicationBiasFlag: boolean;
  error: string | null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unexpected error while building this evidence report.";
}

// Reduce one input item to a single comparable row. Never throws: a failure in
// buildEvidenceReport is captured on the row so the batch keeps going.
function buildRow(item: BatchItem, index: number): EvidenceReportBatchRow {
  const id = item.id ?? String(index);
  const base: EvidenceReportBatchRow = {
    id,
    verdict: "error",
    certainty: null,
    pooledPoint: null,
    pooledCiLower: null,
    pooledCiUpper: null,
    iSquared: null,
    publicationBiasFlag: false,
    error: null,
  };

  try {
    const report = buildEvidenceReport({
      claim: item.claim,
      studies: item.studies,
      riskOfBiasSteps: item.risk_of_bias_steps,
      indirectnessSteps: item.indirectness_steps,
    });

    if (!report.ok) {
      // Honest "couldn't pool" — not an error, a defensible verdict.
      return { ...base, verdict: "insufficient_evidence" };
    }

    return {
      ...base,
      verdict: report.verdict.verdict,
      certainty: report.certainty.certainty,
      pooledPoint: report.pooled.random.point,
      pooledCiLower: report.pooled.random.ciLower,
      pooledCiUpper: report.pooled.random.ciUpper,
      iSquared: report.pooled.heterogeneity.iSquared,
      publicationBiasFlag:
        report.publicationBias.verdict === "possible_small_study_effects",
    };
  } catch (err) {
    return { ...base, verdict: "error", error: errorMessage(err) };
  }
}

/**
 * Run buildEvidenceReport across a batch of claim+study items and reduce each to
 * a compact, comparable row. Pure, deterministic, and fault-isolated: one bad
 * item captures its error and the batch continues. Preserves input order and
 * never mutates its inputs.
 */
export function buildEvidenceReportBatch(
  items: readonly BatchItem[]
): EvidenceReportBatchRow[] {
  return items.map((item, index) => buildRow(item, index));
}

// Stable column order for the CSV export. Keep in sync with EvidenceReportBatchRow.
const CSV_COLUMNS = [
  "id",
  "verdict",
  "certainty",
  "pooledPoint",
  "pooledCiLower",
  "pooledCiUpper",
  "iSquared",
  "publicationBiasFlag",
  "error",
] as const;

function toCsvCell(value: string | number | boolean | null): string | number {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

/**
 * Serialize batch results to a deterministic CSV string with a fixed header +
 * one row per result, in the order given. Reuses lib/csvExport's RFC-4180
 * quoting so any field with a comma/quote/newline is escaped consistently.
 */
export function evidenceReportBatchToCsv(
  results: readonly EvidenceReportBatchRow[]
): string {
  const rows = results.map((r) => ({
    id: toCsvCell(r.id),
    verdict: toCsvCell(r.verdict),
    certainty: toCsvCell(r.certainty),
    pooledPoint: toCsvCell(r.pooledPoint),
    pooledCiLower: toCsvCell(r.pooledCiLower),
    pooledCiUpper: toCsvCell(r.pooledCiUpper),
    iSquared: toCsvCell(r.iSquared),
    publicationBiasFlag: toCsvCell(r.publicationBiasFlag),
    error: toCsvCell(r.error),
  }));
  return toCsv(rows, [...CSV_COLUMNS]);
}
