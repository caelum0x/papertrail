export interface StatsData {
  total_verifications: number;
  total_sources: number;
  avg_trust_score: number | null;
  by_discrepancy_type: Record<string, number>;
  flagged_rate: number;
}

export const LABELS: Record<string, string> = {
  accurate: "Accurate",
  magnitude_overstated: "Magnitude overstated",
  population_overgeneralized: "Population overgeneralized",
  caveat_dropped: "Caveat dropped",
  no_support_found: "No support found",
};

export function barClasses(type: string): string {
  if (type === "accurate") return "bg-green-500";
  if (type === "no_support_found") return "bg-ink/30";
  return "bg-red-500";
}
