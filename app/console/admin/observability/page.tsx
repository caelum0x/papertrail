import { ModuleHeader } from "@/components/observability/ModuleHeader";
import { HealthPanel } from "@/components/observability/HealthPanel";
import { MetricsGrid } from "@/components/observability/MetricsGrid";
import { RecentErrors } from "@/components/observability/RecentErrors";

// Observability overview: at-a-glance system health, a metrics snapshot, and
// the most recent errors. Composes small client components; the page itself is
// a thin server component.

export default function ObservabilityOverviewPage() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Observability"
        description="Platform health, metrics, and error signals for this organization."
      />
      <HealthPanel />
      <MetricsGrid window="24h" buckets={32} />
      <RecentErrors limit={6} />
    </div>
  );
}
