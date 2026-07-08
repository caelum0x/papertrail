"use client";

// Announcements landing page. Lists the org's announcements with search/kind
// filters and pagination. Admins additionally get an inline composer (CreateCard)
// and per-row publish/delete actions. Owns all list + filter + mutation state.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { ModuleHeader } from "@/components/announcements/ModuleHeader";
import { Pagination } from "@/components/announcements/Pagination";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { Filters } from "./_components/Filters";
import { CreateCard } from "./_components/CreateCard";
import { AnnouncementList } from "./_components/AnnouncementList";
import {
  apiGet,
  apiSend,
  type AnnouncementDto,
  type AnnouncementKind,
  type CreateAnnouncementPayload,
} from "./api";

const PAGE_LIMIT = 20;

export default function AnnouncementsPage() {
  const { canManage: isAdmin } = useCurrentRole();

  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AnnouncementKind | "">("");
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<AnnouncementDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createError, setCreateError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
    });
    if (kind) params.set("kind", kind);
    if (query) params.set("search", query);
    if (publishedOnly) params.set("published", "1");

    const res = await apiGet<AnnouncementDto[]>(`/api/announcements?${params}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load announcements.");
      setLoading(false);
      return;
    }
    setItems(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [page, kind, query, publishedOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounce free-text search.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const onCreate = useCallback(
    async (payload: CreateAnnouncementPayload): Promise<boolean> => {
      setCreateError(null);
      const res = await apiSend<AnnouncementDto>(
        "/api/announcements",
        "POST",
        payload
      );
      if (!res.success) {
        setCreateError(res.error ?? "Failed to create announcement.");
        return false;
      }
      setPage(1);
      await load();
      return true;
    },
    [load]
  );

  const onPublish = useCallback(
    async (id: string) => {
      setBusyId(id);
      await apiSend(`/api/announcements/${id}/publish`, "POST").catch(
        () => undefined
      );
      setBusyId(null);
      await load();
    },
    [load]
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (typeof window !== "undefined") {
        const ok = window.confirm("Delete this announcement? This cannot be undone.");
        if (!ok) return;
      }
      setBusyId(id);
      await apiSend(`/api/announcements/${id}`, "DELETE").catch(() => undefined);
      setBusyId(null);
      await load();
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
        title="Announcements"
        subtitle="Product news, maintenance notices, and updates for your team."
        action={
          <a
            href="/console/announcements/releases"
            className="text-sm text-accent hover:underline"
          >
            View releases
          </a>
        }
      />

      <div className="mt-6">
        <AnnouncementBanner />
      </div>

      {isAdmin ? (
        <div className="mt-6">
          <CreateCard onCreate={onCreate} error={createError} />
        </div>
      ) : null}

      <div className="mt-6">
        <Filters
          search={searchInput}
          onSearch={setSearchInput}
          kind={kind}
          onKind={(v) => {
            setKind(v);
            setPage(1);
          }}
          isAdmin={isAdmin}
          publishedOnly={publishedOnly}
          onPublishedOnly={(v) => {
            setPublishedOnly(v);
            setPage(1);
          }}
        />
      </div>

      <div className="mt-4">
        <AnnouncementList
          items={items}
          loading={loading}
          error={error}
          isAdmin={isAdmin}
          onRetry={() => void load()}
          onPublish={onPublish}
          onDelete={onDelete}
          busyId={busyId}
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
