import { ModuleHeader } from "@/components/observability/ModuleHeader";
import { ErrorTable } from "@/components/observability/ErrorTable";

// Errors list page: filterable, paginated table of ingested error events.

export default function ObservabilityErrorsPage() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Observability"
        description="Application error and warning events, newest first."
      />
      <ErrorTable />
    </div>
  );
}
