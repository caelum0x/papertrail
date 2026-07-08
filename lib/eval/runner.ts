import type { Pool } from "pg";
import { retrieveSources } from "@/lib/agents/retrievalAgent";
import { extractFinding } from "@/lib/agents/extractionAgent";
import { verifyClaim } from "@/lib/agents/verificationAgent";
import { scoreCase, scoreToBand } from "@/lib/eval/scorer";
import {
  createEvalRun,
  finalizeEvalRun,
  getAllEvalCases,
  insertEvalResult,
} from "@/lib/eval/queries";
import type {
  CaseScore,
  EvalCase,
  EvalRun,
  EvalRunSummary,
  PredictedResult,
} from "@/lib/eval/types";

// Runs a whole eval set through the real verification pipeline (retrieve ->
// extract -> verify), scores each case with the pure scorer, persists per-case
// results, and rolls up run-level accuracy + span-grounding metrics.
//
// The run row is created as 'running' up front so a crash mid-run leaves a
// visible record; on completion it's finalized to 'completed' (or 'failed' if
// the whole run threw before any case could be scored).

function emptySummary(): EvalRunSummary {
  return {
    totalCases: 0,
    passedCases: 0,
    discrepancyMatches: 0,
    spanGroundedCases: 0,
    spanGroundingApplicableCases: 0,
    trustBandMatches: 0,
    errorCases: 0,
    byExpectedType: {},
  };
}

/**
 * Execute the pipeline for a single case and return the flattened prediction.
 * Any failure (no confident source, LLM error, etc.) is captured as an errored
 * prediction rather than thrown — one bad case must not sink the whole run.
 */
export async function predictForCase(caseRow: EvalCase): Promise<PredictedResult> {
  try {
    const sources = await retrieveSources(
      caseRow.claim,
      caseRow.sourceExternalId ? { preferExternalId: caseRow.sourceExternalId } : undefined
    );

    if (sources.length === 0) {
      // Honest "couldn't verify" — this is itself a valid predicted verdict.
      return {
        discrepancyType: "no_support_found",
        trustScore: 0,
        trustBand: "low",
        flaggedSourceSpans: [],
        matchedSourceExternalId: null,
        error: null,
      };
    }

    const source = sources[0];
    const findings = await Promise.all(sources.map((s) => extractFinding(s.id, s.raw_text)));
    const verification = await verifyClaim({
      claim: caseRow.claim,
      finding: findings[0],
      sourceRawText: source.raw_text,
      otherFindings: findings.slice(1),
    });

    return {
      discrepancyType: verification.discrepancy_type,
      trustScore: verification.trust_score,
      trustBand: scoreToBand(verification.trust_score),
      flaggedSourceSpans: verification.flagged_spans.map((s) => s.source_span),
      matchedSourceExternalId: source.external_id,
      error: null,
    };
  } catch (err) {
    return {
      discrepancyType: null,
      trustScore: null,
      trustBand: null,
      flaggedSourceSpans: [],
      matchedSourceExternalId: null,
      error: err instanceof Error ? err.message : "Pipeline error.",
    };
  }
}

function accumulate(summary: EvalRunSummary, caseRow: EvalCase, score: CaseScore, errored: boolean): void {
  summary.totalCases += 1;
  if (score.passed) summary.passedCases += 1;
  if (score.discrepancyMatch) summary.discrepancyMatches += 1;
  if (score.trustBandMatch) summary.trustBandMatches += 1;
  if (errored) summary.errorCases += 1;
  if (score.spanGroundingApplicable) {
    summary.spanGroundingApplicableCases += 1;
    if (score.spanGrounded) summary.spanGroundedCases += 1;
  }
  const key = caseRow.expectedDiscrepancyType;
  const byType = summary.byExpectedType ?? (summary.byExpectedType = {});
  const bucket = byType[key] ?? (byType[key] = { total: 0, passed: 0 });
  bucket.total += 1;
  if (score.passed) bucket.passed += 1;
}

/**
 * Create and execute an eval run for a set. Returns the finalized run row (with
 * accuracy + span_grounding_rate). Persistence of the run + per-case results is
 * done as it goes; the run is finalized 'completed' with rolled-up metrics.
 */
export async function runEvalSet(
  pool: Pool,
  params: { orgId: string; evalSetId: string }
): Promise<EvalRun> {
  const cases = await getAllEvalCases(pool, params.orgId, params.evalSetId);
  const run = await createEvalRun(pool, {
    orgId: params.orgId,
    evalSetId: params.evalSetId,
  });

  const summary = emptySummary();

  try {
    for (const caseRow of cases) {
      const predicted = await predictForCase(caseRow);
      const score = scoreCase(predicted, {
        discrepancyType: caseRow.expectedDiscrepancyType,
        expectedSubstrings: caseRow.expectedSubstrings,
      });

      await insertEvalResult(pool, {
        orgId: params.orgId,
        runId: run.id,
        caseId: caseRow.id,
        predicted: { ...predicted, score },
        passed: score.passed,
      });

      accumulate(summary, caseRow, score, Boolean(predicted.error));
    }

    const accuracy =
      summary.totalCases > 0 ? summary.passedCases / summary.totalCases : 0;
    const spanGroundingRate =
      summary.spanGroundingApplicableCases > 0
        ? summary.spanGroundedCases / summary.spanGroundingApplicableCases
        : null;

    const finalized = await finalizeEvalRun(pool, {
      orgId: params.orgId,
      runId: run.id,
      status: "completed",
      accuracy,
      spanGroundingRate,
      summary,
    });
    return finalized ?? { ...run, status: "completed", accuracy, spanGroundingRate, summary };
  } catch (err) {
    const finalized = await finalizeEvalRun(pool, {
      orgId: params.orgId,
      runId: run.id,
      status: "failed",
      accuracy: null,
      spanGroundingRate: null,
      summary: { ...summary },
    });
    if (finalized) return finalized;
    throw err;
  }
}
