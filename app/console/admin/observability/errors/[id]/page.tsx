import { ModuleHeader } from "@/components/observability/ModuleHeader";
import { ErrorDetail } from "@/components/observability/ErrorDetail";

// Single error event detail page.

export default function ObservabilityErrorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Observability"
        description="Error event detail."
      />
      <ErrorDetail id={params.id} />
    </div>
  );
}
