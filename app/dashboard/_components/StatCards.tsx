import { StatCard } from "./StatCard";
import type { StatsData } from "./dashboardShared";

interface StatCardsProps {
  stats: StatsData;
}

export function StatCards({ stats }: StatCardsProps) {
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Verifications" value={String(stats.total_verifications)} />
      <StatCard label="Sources cached" value={String(stats.total_sources)} />
      <StatCard
        label="Avg trust score"
        value={stats.avg_trust_score === null ? "—" : String(stats.avg_trust_score)}
      />
      <StatCard label="Flagged rate" value={`${Math.round(stats.flagged_rate * 100)}%`} />
    </section>
  );
}
