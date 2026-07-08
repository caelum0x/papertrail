import type { DiscrepancyType } from "@/lib/eval/schemas";

// Domain types for the agent-eval module. These mirror the migration 0027 tables
// (camelCased) plus the derived scoring shapes produced by the scorer/runner.

export const EVAL_RUN_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];

export interface EvalSet {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  createdAt: string;
  caseCount?: number;
  runCount?: number;
  lastAccuracy?: number | null;
}

export interface EvalCase {
  id: string;
  orgId: string;
  evalSetId: string;
  claim: string;
  sourceExternalId: string | null;
  expectedDiscrepancyType: DiscrepancyType;
  expectedSubstrings: string[];
  createdAt: string;
}

export interface EvalRun {
  id: string;
  orgId: string;
  evalSetId: string;
  status: EvalRunStatus;
  accuracy: number | null;
  spanGroundingRate: number | null;
  summary: EvalRunSummary;
  createdAt: string;
}

// jsonb roll-up stored on eval_runs.summary.
export interface EvalRunSummary {
  totalCases: number;
  passedCases: number;
  discrepancyMatches: number;
  spanGroundedCases: number;
  spanGroundingApplicableCases: number;
  trustBandMatches: number;
  errorCases: number;
  byExpectedType?: Record<string, { total: number; passed: number }>;
}

// The trust band an expected discrepancy_type implies, used to score the
// numeric trust_score against the label without hardcoding exact scores.
export type TrustBand = "high" | "moderate" | "low";

// What the pipeline produced for one case (the snapshot stored in
// eval_results.predicted alongside the scoring breakdown).
export interface PredictedResult {
  discrepancyType: DiscrepancyType | null;
  trustScore: number | null;
  trustBand: TrustBand | null;
  flaggedSourceSpans: string[];
  matchedSourceExternalId: string | null;
  error?: string | null;
}

// The expected/labeled outcome pulled from an eval_case.
export interface ExpectedResult {
  discrepancyType: DiscrepancyType;
  expectedSubstrings: string[];
}

// The per-dimension scoring breakdown for a single case.
export interface CaseScore {
  passed: boolean;
  discrepancyMatch: boolean;
  // Whether every expected substring was found within a flagged source span.
  spanGrounded: boolean;
  // False when the case had no expected substrings (span grounding not applicable).
  spanGroundingApplicable: boolean;
  trustBandMatch: boolean;
}
