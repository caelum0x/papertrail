import type { UsageSummary } from "@/lib/apiusage/types";
import { formatMs, formatNumber, formatRate } from "./shared";

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "danger";
}

function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  const valueClass =
    tone === "danger"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-ink/80";
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-ink/40">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink/40">{hint}</p> : null}
    </div>
  );
}

// Top-of-summary KPI row. errorRate is toned amber/danger past thresholds so a
// glance surfaces trouble.
export function StatCards({ summary }: { summary: UsageSummary }) {
  const errorTone =
    summary.errorRate >= 0.1
      ? "danger"
      : summary.errorRate >= 0.02
        ? "warn"
        : "default";
  const rlTone = summary.rateLimitedCount > 0 ? "warn" : "default";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total requests"
        value={formatNumber(summary.totalRequests)}
        hint={`over ${summary.rangeDays} days`}
      />
      <StatCard
        label="Error rate"
        value={formatRate(summary.errorRate)}
        hint={`${formatNumber(summary.totalErrors)} errors`}
        tone={errorTone}
      />
      <StatCard
        label="Latency p95"
        value={formatMs(summary.p95DurationMs)}
        hint={`avg ${formatMs(summary.avgDurationMs)}`}
      />
      <StatCard
        label="Rate limited"
        value={formatNumber(summary.rateLimitedCount)}
        hint={`${formatNumber(summary.activeKeys)} active keys`}
        tone={rlTone}
      />
    </div>
  );
}
