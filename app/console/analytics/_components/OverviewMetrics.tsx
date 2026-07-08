import {
  formatPct,
  labelFor,
  type OverviewMetrics as OverviewMetricsData,
} from "../client";
import { BarChart, ChartCard, KpiCard } from "../components";

interface OverviewMetricsProps {
  metrics: OverviewMetricsData;
}

// KPI cards + distortion-by-type chart for the analytics overview.
export function OverviewMetrics({ metrics }: OverviewMetricsProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Claims verified"
          value={String(metrics.claimsVerified)}
          hint={`${metrics.totalVerifications} verifications`}
        />
        <KpiCard
          label="Distortion rate"
          value={formatPct(metrics.distortionRate)}
          hint="Non-accurate outcomes"
        />
        <KpiCard
          label="Documents processed"
          value={String(metrics.documentsProcessed)}
        />
        <KpiCard
          label="Avg trust score"
          value={
            metrics.avgTrustScore === null
              ? "—"
              : `${metrics.avgTrustScore}/100`
          }
        />
      </div>

      <div className="mt-4">
        <ChartCard
          title="Distortion by type"
          description="How this org's verification outcomes break down."
        >
          <BarChart
            data={metrics.distortionByType.map((d) => ({
              label: labelFor(d.type),
              value: d.count,
              suffix: formatPct(d.rate),
            }))}
            emptyMessage="No verification outcomes yet."
          />
        </ChartCard>
      </div>
    </>
  );
}
