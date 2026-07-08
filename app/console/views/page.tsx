"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ModuleHeader } from "@/components/views/ModuleHeader";
import { ResourceFilter } from "@/components/views/ResourceFilter";
import { NewViewCard } from "@/components/views/NewViewCard";
import { ViewsList } from "@/components/views/ViewsList";
import { EmptyState } from "@/components/views/EmptyState";
import { Pagination } from "@/components/views/Pagination";
import {
  fetchViews,
  deleteView,
  isViewResource,
  type SavedViewDto,
  type ViewResource,
} from "@/components/views/api";

const PAGE_LIMIT = 20;

function ViewsListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialResource = searchParams.get("resource");
  const [resource, setResource] = useState<ViewResource | "all">(
    isViewResource(initialResource) ? initialResource : "all"
  );

  const [views, setViews] = useState<SavedViewDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number, r: ViewResource | "all") => {
      setLoading(true);
      setError(null);
      const res = await fetchViews({
        page: p,
        limit: PAGE_LIMIT,
        resource: r === "all" ? undefined : r,
      });
      if (!res.success || !res.data) {
        setError(res.error ?? "Failed to load views.");
        setLoading(false);
        return;
      }
      setViews(res.data);
      setTotal(res.meta?.total ?? res.data.length);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    void load(page, resource);
  }, [load, page, resource]);

  const handleResourceChange = (next: ViewResource | "all") => {
    setResource(next);
    setPage(1);
    const params = new URLSearchParams();
    if (next !== "all") params.set("resource", next);
    const qs = params.toString();
    router.replace(`/console/views${qs ? `?${qs}` : ""}`);
  };

  const handleDelete = async (view: SavedViewDto) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Delete “${view.name}”? This can't be undone.`);
      if (!confirmed) return;
    }
    setDeletingId(view.id);
    setActionError(null);
    const res = await deleteView(view.id);
    setDeletingId(null);
    if (!res.success) {
      setActionError(res.error ?? "Failed to delete view.");
      return;
    }
    setViews((prev) => prev.filter((v) => v.id !== view.id));
    setTotal((prev) => Math.max(0, prev - 1));
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Saved views"
        description="Reusable searches, filters, and sorts you can share across the org."
        actionHref="/console/views/new"
        actionLabel="New view"
      />

      <ResourceFilter value={resource} onChange={handleResourceChange} />

      <NewViewCard href="/console/views/new" />

      {actionError ? (
        <p className="text-sm text-red-600">{actionError}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink/40">Loading views...</p>
      ) : error ? (
        <div className="rounded-lg border border-ink/10 bg-white p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={() => void load(page, resource)}
            className="mt-2 text-sm text-accent"
          >
            Retry
          </button>
        </div>
      ) : views.length === 0 ? (
        <EmptyState
          title={
            resource === "all"
              ? "No saved views yet"
              : "No views for this resource"
          }
          message="Create a view to capture a search, filters, and sort you use often — then reuse it from any list page."
          actionHref="/console/views/new"
          actionLabel="New view"
        />
      ) : (
        <ViewsList
          views={views}
          deletingId={deletingId}
          onDelete={handleDelete}
        />
      )}

      {!loading && !error && total > PAGE_LIMIT ? (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  );
}

export default function ViewsPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-ink/40">Loading views...</p>}
    >
      <ViewsListPage />
    </Suspense>
  );
}
