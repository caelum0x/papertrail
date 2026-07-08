import { ModuleHeader } from "@/components/observability/ModuleHeader";
import { LogViewer } from "@/components/observability/LogViewer";

// Unified log viewer page: merges error events and audit-trail actions into one
// filterable, paginated stream.

export default function ObservabilityLogsPage() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Observability"
        description="Recent activity across error events and the audit trail."
      />
      <LogViewer />
    </div>
  );
}
