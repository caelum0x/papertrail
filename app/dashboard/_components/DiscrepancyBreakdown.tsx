import { barClasses, LABELS, type StatsData } from "./dashboardShared";

interface DiscrepancyBreakdownProps {
  stats: StatsData;
}

export function DiscrepancyBreakdown({ stats }: DiscrepancyBreakdownProps) {
  const entries = Object.entries(stats.by_discrepancy_type);
  const maxCount = entries.reduce((max, [, count]) => Math.max(max, count), 0);

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink/40">
        By discrepancy type
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-ink/50">No verifications yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <li key={type} className="flex items-center gap-3">
                <span className="w-48 shrink-0 text-sm text-ink/80">
                  {LABELS[type] ?? type}
                </span>
                <div className="h-4 flex-1 rounded bg-ink/5">
                  <div
                    className={`h-4 rounded ${barClasses(type)}`}
                    style={{ width: maxCount > 0 ? `${(count / maxCount) * 100}%` : "0%" }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-sm tabular-nums text-ink/60">
                  {count}
                </span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
