import { ModuleHeader } from "@/components/observability/ModuleHeader";
import { MetricsExplorer } from "@/components/observability/MetricsExplorer";

// Dedicated metrics page: window selector + per-metric chart cards.

export default function ObservabilityMetricsPage() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Observability"
        description="Time-series metrics recorded by the platform."
      />
      <MetricsExplorer />
    </div>
  );
}
