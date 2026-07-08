"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ModuleHeader } from "../_components/ModuleHeader";
import { DashboardGrid } from "../_components/DashboardGrid";
import { EmptyState } from "../_components/EmptyState";
import { useRole } from "../_components/useRole";
import { fetchDashboard, fetchDashboardData } from "../_components/api";
import type { Dashboard, DashboardData } from "../_components/types";

export default function DashboardDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { canEdit } = useRole();

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [metaRes, dataRes] = await Promise.all([
      fetchDashboard(id),
      fetchDashboardData(id),
    ]);
    if (metaRes.error || dataRes.error) {
      setError(metaRes.error ?? dataRes.error);
      setDashboard(null);
      setData(null);
    } else {
      setDashboard(metaRes.data);
      setData(dataRes.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <ModuleHeader
        title={dashboard?.name ?? "Dashboard"}
        description={
          dashboard?.is_default ? "Default dashboard for this organization." : undefined
        }
        actions={
          <>
            <Link
              href="/console/dashboards"
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
            >
              All dashboards
            </Link>
            {canEdit && id ? (
              <Link
                href={`/console/dashboards/${id}/edit`}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
              >
                Edit
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mt-6">
        {loading ? (
          <div className="rounded-lg border border-ink/15 bg-white p-10 text-center text-sm text-ink/40">
            Loading dashboard…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-ink/15 bg-white p-10 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={load}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : !data || data.widgets.length === 0 ? (
          <div className="rounded-lg border border-ink/15 bg-white">
            <EmptyState
              title="No widgets yet"
              description="Add metric, list, and chart widgets in the editor."
              action={
                canEdit && id ? (
                  <Link
                    href={`/console/dashboards/${id}/edit`}
                    className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white"
                  >
                    Open editor
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <DashboardGrid
            layout={dashboard?.layout ?? { columns: 3, gap: 16 }}
            widgets={data.widgets}
          />
        )}
      </div>
    </div>
  );
}
