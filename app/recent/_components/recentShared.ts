export interface RecentItem {
  id: string;
  claim_text: string;
  discrepancy_type: string;
  trust_score: number;
  created_at: string;
}

export const LABELS: Record<string, string> = {
  accurate: "Accurate",
  magnitude_overstated: "Magnitude overstated",
  population_overgeneralized: "Population overgeneralized",
  caveat_dropped: "Caveat dropped",
  no_support_found: "No support found",
};

export const DISCREPANCY_TYPES = Object.keys(LABELS);

export function scoreClasses(score: number): string {
  if (score >= 90) return "bg-green-100 text-green-800";
  if (score >= 60) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}
