import {
  formatPct,
  labelFor,
  type VerificationAnalytics,
} from "../client";
import { BarChart, ChartCard, ColumnChart, KpiCard } from "../components";

interface VerificationChartsProps {
  data: VerificationAnalytics;
}

// KPI row + time-series column chart + outcome / trust breakdowns for the
// verification-trends sub-page.
export function VerificationCharts({ data }: VerificationChartsProps) {
  const scored = data.series.filter((p) => p.avgTrustScore !== null);
  const avgTrust =
    scored.length > 0
      ? Math.round(
          scored.reduce((sum, p) => sum + (p.avgTrustScore ?? 0), 0) /
            scored.length
        )
      : null;

  const distortionCount = data.byType
    .filter((b) => b.type !== "accurate")
    .reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Verifications"
          value={String(data.totalInRange)}
          hint={`Last ${data.rangeDays} days`}
        />
        <KpiCard
          label="Flagged (distortions)"
          value={String(distortionCount)}
          hint={formatPct(
            data.totalInRange > 0 ? distortionCount / data.totalInRange : 0
          )}
        />
        <KpiCard
          label="Avg trust score"
          value={avgTrust === null ? "—" : `${avgTrust}/100`}
        />
      </div>

      <ChartCard
        title="Verifications over time"
        description="Total per day; the darker inset shows flagged (distortion) verifications."
      >
        <ColumnChart
          data={data.series.map((p) => ({
            label: p.date,
            primary: p.total,
            secondary: p.distortions,
          }))}
        />
        <div className="mt-2 flex justify-between text-xs text-ink/40">
          <span>{data.series[0]?.date ?? ""}</span>
          <span>{data.series[data.series.length - 1]?.date ?? ""}</span>
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Outcome breakdown">
          <BarChart
            data={data.byType.map((b) => ({
              label: labelFor(b.type),
              value: b.count,
              suffix: formatPct(b.rate),
            }))}
          />
        </ChartCard>
        <ChartCard
          title="Trust score distribution"
          description="Verifications grouped by trust score band."
        >
          <BarChart
            data={data.trustDistribution.map((t) => ({
              label: t.label,
              value: t.count,
            }))}
            emptyMessage="No scored verifications in range."
          />
        </ChartCard>
      </div>
    </div>
  );
}
