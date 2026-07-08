"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleHeader } from "./_components/ModuleHeader";
import { CreateCard } from "./_components/CreateCard";
import { DashboardList } from "./_components/DashboardList";
import { EmptyState } from "./_components/EmptyState";
import { Pagination } from "./_components/Pagination";
import { useRole } from "./_components/useRole";
import {
  createDashboard,
  deleteDashboard,
  fetchDashboards,
} from "./_components/api";
import type { Dashboard } from "./_components/types";

const PAGE_SIZE = 20;

export default function DashboardsPage() {
  const { canEdit } = useRole();

  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchDashboards(page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setDashboards([]);
      setTotal(0);
    } else {
      setDashboards(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (name: string, isDefault: boolean) => {
    setCreating(true);
    setCreateError(null);
    const result = await createDashboard({ name, isDefault });
    setCreating(false);
    if (result.error) {
      setCreateError(result.error);
      return;
    }
    setPage(1);
    await load();
  };

  const onDelete = async (id: string) => {
    const result = await deleteDashboard(id);
    if (result.error) {
      setError(result.error);
      return;
    }
    await load();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="Dashboards"
        description="Build org-scoped dashboards from metric, list, and chart widgets."
      />

      {canEdit ? (
        <div className="mt-6">
          <CreateCard
            creating={creating}
            error={createError}
            onCreate={onCreate}
          />
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <div className="p-10 text-center text-sm text-ink/40">
            Loading dashboards…
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={load}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : dashboards.length === 0 ? (
          <EmptyState
            title="No dashboards yet"
            description={
              canEdit
                ? "Create your first dashboard above, then add widgets in the editor."
                : "No dashboards have been created for this organization yet."
            }
          />
        ) : (
          <DashboardList
            dashboards={dashboards}
            canEdit={canEdit}
            onDelete={onDelete}
          />
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
