// Shared client helpers for the evaluation console pages. Kept tiny and
// framework-free so each page imports only what it needs.

const ORG_STORAGE_KEY = "pt_active_org";

export function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

export function accuracyClasses(value: number | null | undefined): string {
  if (value === null || value === undefined) return "bg-paper text-ink/60 border-ink/15";
  if (value >= 0.9) return "bg-green-50 text-green-700 border-green-200";
  if (value >= 0.6) return "bg-yellow-50 text-yellow-800 border-yellow-200";
  return "bg-red-50 text-red-700 border-red-200";
}

export function statusClasses(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-50 text-green-700 border-green-200";
    case "failed":
      return "bg-red-50 text-red-700 border-red-200";
    case "running":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-paper text-ink/60 border-ink/15";
  }
}

export const DISCREPANCY_OPTIONS: { value: string; label: string }[] = [
  { value: "accurate", label: "Accurate" },
  { value: "magnitude_overstated", label: "Magnitude overstated" },
  { value: "population_overgeneralized", label: "Population overgeneralized" },
  { value: "caveat_dropped", label: "Caveat dropped" },
  { value: "no_support_found", label: "No support found" },
];

export interface EvalSet {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  caseCount?: number;
  runCount?: number;
  lastAccuracy?: number | null;
}

export interface EvalCase {
  id: string;
  evalSetId: string;
  claim: string;
  sourceExternalId: string | null;
  expectedDiscrepancyType: string;
  expectedSubstrings: string[];
  createdAt: string;
}

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

export interface EvalRun {
  id: string;
  evalSetId: string;
  status: string;
  accuracy: number | null;
  spanGroundingRate: number | null;
  summary: EvalRunSummary;
  createdAt: string;
}

export interface PredictedResult {
  discrepancyType: string | null;
  trustScore: number | null;
  trustBand: string | null;
  flaggedSourceSpans: string[];
  matchedSourceExternalId: string | null;
  error?: string | null;
}

export interface EvalResultRecord {
  id: string;
  caseId: string;
  predicted: PredictedResult & {
    score?: {
      passed: boolean;
      discrepancyMatch: boolean;
      spanGrounded: boolean;
      spanGroundingApplicable: boolean;
      trustBandMatch: boolean;
    };
  };
  passed: boolean;
  createdAt: string;
  case?: EvalCase | null;
}
