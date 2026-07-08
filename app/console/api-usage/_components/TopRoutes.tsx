import type { RouteUsage } from "@/lib/apiusage/types";
import { EmptyState } from "./StateBlock";
import { formatMs, formatNumber, formatRate } from "./shared";

// Top-N routes by request volume, with a proportional volume bar and error rate.
export function TopRoutes({ routes }: { routes: RouteUsage[] }) {
  if (routes.length === 0) {
    return <EmptyState>No route traffic in this window.</EmptyState>;
  }
  const max = Math.max(...routes.map((r) => r.requests), 1);

  return (
    <ul className="divide-y divide-ink/10">
      {routes.map((r) => (
        <li key={r.route} className="px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <code className="truncate text-sm text-ink/80">{r.route}</code>
            <span className="shrink-0 text-sm text-ink/60">
              {formatNumber(r.requests)} req
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/5">
              <div
                className="h-full rounded-full bg-accent/60"
                style={{ width: `${(r.requests / max) * 100}%` }}
              />
            </div>
            <span
              className={
                r.errorRate >= 0.1
                  ? "shrink-0 text-xs text-red-700"
                  : "shrink-0 text-xs text-ink/40"
              }
            >
              {formatRate(r.errorRate)} err · p95 {formatMs(r.p95DurationMs)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
