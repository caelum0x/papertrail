export interface EvalSummary {
  total: number;
  passed: number;
  discrepancy_type_accuracy: number | null;
  span_grounding_rate: number | null;
}

export interface EvalResult {
  id: string;
  status: "pass" | "fail" | "skip" | "error";
  expectedFailure?: boolean;
  discrepancyType?: string;
  expectedDiscrepancyType?: string;
  trustScore?: number;
  flagCount?: number;
  groundingOk?: boolean;
  coverageRatio?: number;
  message?: string;
}

export interface EvalResults {
  generatedAt: string | null;
  summary: EvalSummary;
  results: EvalResult[];
}

const DISCREPANCY_LABELS: Readonly<Record<string, string>> = {
  accurate: "Accurate",
  magnitude_overstated: "Magnitude overstated",
  population_overgeneralized: "Population overgeneralized",
  caveat_dropped: "Caveat dropped",
  no_support_found: "No support found",
};

export function labelFor(type: string | undefined): string {
  if (!type) return "—";
  return DISCREPANCY_LABELS[type] ?? type;
}

export function formatPct(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${Math.round(ratio * 100)}%`;
}

export function statusClasses(status: EvalResult["status"]): string {
  if (status === "pass") return "bg-green-100 text-green-800";
  if (status === "fail" || status === "error") return "bg-red-100 text-red-800";
  return "bg-ink/10 text-ink/60";
}
