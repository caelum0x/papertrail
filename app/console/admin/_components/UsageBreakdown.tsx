interface UsageBreakdownProps {
  title: string;
  rows: { label: string; count: number }[];
}

// Horizontal bar breakdown of labelled counts, scaled to the largest value.
export function UsageBreakdown({ title, rows }: UsageBreakdownProps) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div className="bg-white border border-ink/10 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/40">No data yet.</p>
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
