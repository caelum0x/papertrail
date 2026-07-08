"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { EventLog } from "../../_components/EventLog";
import { useIntegrationDetail } from "../../_components/useIntegrationDetail";

// Dedicated activity sub-page for one integration: the full recent-events log on
// its own route for direct linking. Reuses the shared useIntegrationDetail hook
// and the existing /api/integrations/[id]/events endpoint (no new APIs).
export default function IntegrationActivityPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const {
    canManage,
    roleLoading,
    integration,
    events,
    loading,
    error,
  } = useIntegrationDetail(id);

  if (!roleLoading && !canManage) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Activity</h1>
        <p className="mt-4 text-sm text-ink/60">
          You need an admin or owner role to view integration activity.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            {integration ? `${integration.name} — activity` : "Activity"}
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            Recent inbound and outbound events for this integration, newest first.
          </p>
        </div>
        <Link
          href={id ? `/console/integrations/${id}` : "/console/integrations"}
          className="shrink-0 text-sm text-ink/60 hover:text-accent"
        >
          ← Integration
        </Link>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading activity...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : !integration ? (
        <p className="mt-6 text-sm text-ink/40">Integration not found.</p>
      ) : (
        <EventLog events={events} />
      )}
    </div>
  );
}
