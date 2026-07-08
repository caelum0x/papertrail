"use client";

// Releases / changelog page. Shows the org's release timeline with pagination.
// Admins get an inline NewReleaseForm to publish a new version. Owns list +
// mutation state.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { ModuleHeader } from "@/components/announcements/ModuleHeader";
import { Pagination } from "@/components/announcements/Pagination";
import { ReleaseTimeline } from "../_components/ReleaseTimeline";
import { NewReleaseForm } from "../_components/NewReleaseForm";
import {
  apiGet,
  apiSend,
  type ReleaseDto,
  type CreateReleasePayload,
} from "../api";

const PAGE_LIMIT = 20;

export default function ReleasesPage() {
  const { canManage: isAdmin } = useCurrentRole();

  const [releases, setReleases] = useState<ReleaseDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
    });
    const res = await apiGet<ReleaseDto[]>(`/api/releases?${params}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load releases.");
      setLoading(false);
      return;
    }
    setReleases(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = useCallback(
    async (payload: CreateReleasePayload): Promise<boolean> => {
      setCreateError(null);
      const res = await apiSend<ReleaseDto>("/api/releases", "POST", payload);
      if (!res.success) {
        setCreateError(res.error ?? "Failed to create release.");
        return false;
      }
      setPage(1);
      await load();
      return true;
    },
    [load]
  );

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_LIMIT)),
    [total]
  );

  return (
    <div>
      <ModuleHeader
        title="Releases"
        subtitle="Version history and changelog for your workspace."
        action={
          <Link
            href="/console/announcements"
            className="text-sm text-accent hover:underline"
          >
            Back to announcements
          </Link>
        }
      />

      {isAdmin ? (
        <div className="mt-6">
          <NewReleaseForm onCreate={onCreate} error={createError} />
        </div>
      ) : null}

      <div className="mt-6">
        <ReleaseTimeline
          releases={releases}
          loading={loading}
          error={error}
          onRetry={() => void load()}
        />
        {!loading && !error ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        ) : null}
      </div>
    </div>
  );
}
