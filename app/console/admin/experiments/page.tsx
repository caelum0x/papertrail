import { ModuleHeader } from "@/components/flags/ModuleHeader";
import { ExperimentList } from "@/components/flags/ExperimentList";

// Experiments list page: composes the shared module header (shared with the
// flags pages) with the stateful experiment list (status filter + create +
// expandable variant panels + pagination).
export default function ExperimentsPage() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Experiments"
        description="Run multi-variant A/B tests with deterministic, sticky subject assignment."
      />
      <ExperimentList />
    </div>
  );
}
