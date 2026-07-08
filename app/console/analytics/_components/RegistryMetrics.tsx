import {
  formatPct,
  labelFor,
  type RegistryAnalytics,
} from "../client";
import { BarChart, ChartCard, KpiCard } from "../components";

interface RegistryMetricsProps {
  data: RegistryAnalytics;
}

// KPI row + outcome distribution chart for the evidence & registry sub-page.
export function RegistryMetrics({ data }: RegistryMetricsProps) {
  const coverage =
    data.trialSourcesMatched > 0
      ? data.sourcesWithRegisteredResults / data.trialSourcesMatched
      : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Trial-matched verifications"
          value={String(data.trialMatchedVerifications)}
          hint="Matched a ClinicalTrials.gov source"
        />
        <KpiCard
          label="Registry-checkable"
          value={String(data.registryCheckable)}
          hint="Source has posted results"
        />
        <KpiCard
          label="Trial sources matched"
          value={String(data.trialSourcesMatched)}
        />
        <KpiCard
          label="Registry coverage"
          value={formatPct(coverage)}
          hint={`${data.sourcesWithRegisteredResults} with results`}
        />
      </div>

      <ChartCard
        title="Registry-check outcome distribution"
        description="Outcomes among verifications whose matched trial has posted registered results."
      >
        <BarChart
          data={data.outcomeDistribution.map((o) => ({
            label: labelFor(o.outcome),
            value: o.count,
            suffix: formatPct(o.rate),
          }))}
          emptyMessage="No registry-checkable verifications yet."
        />
      </ChartCard>
    </div>
  );
}
