interface AuditBreakdownProps {
  title: string;
  rows: { label: string; count: number }[];
  emptyLabel?: string;
}

// Horizontal bar breakdown for a set of labelled counts (e.g. events by action
// or entity type). Bars are scaled to the largest value in the set.
export function AuditBreakdown({
  title,
  rows,
  emptyLabel = "No data yet.",
}: AuditBreakdownProps) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div className="bg-white border border-ink/10 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/40">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-center justify-between text-xs text-ink/60">
                <span className="capitalize">{r.label.replace(/_/g, " ")}</span>
                <span className="tabular-nums">{r.count.toLocaleString()}</span>
              </div>
              <div className="mt-1 h-1.5 bg-paper rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
