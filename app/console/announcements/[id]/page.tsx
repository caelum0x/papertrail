"use client";

// Announcement detail page. Fetches one announcement, renders it via
// AnnouncementView, and marks it read on mount (once) if it's published and
// unread. Admins can publish a draft or delete from here.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { ModuleHeader } from "@/components/announcements/ModuleHeader";
import { AnnouncementView } from "../_components/AnnouncementView";
import { apiGet, apiSend, type AnnouncementDto } from "../api";

export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { canManage: isAdmin } = useCurrentRole();

  const [announcement, setAnnouncement] = useState<AnnouncementDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const markedRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await apiGet<AnnouncementDto>(`/api/announcements/${id}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load announcement.");
      setLoading(false);
      return;
    }
    setAnnouncement(res.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark read once when viewing a published, unread announcement.
  useEffect(() => {
    if (
      !id ||
      markedRef.current ||
      !announcement ||
      announcement.publishedAt === null ||
      announcement.read !== false
    ) {
      return;
    }
    markedRef.current = true;
    void apiSend(`/api/announcements/${id}/read`, "POST").catch(() => undefined);
  }, [id, announcement]);

  const onPublish = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    await apiSend(`/api/announcements/${id}/publish`, "POST").catch(
      () => undefined
    );
    setBusy(false);
    await load();
  }, [id, load]);

  const onDelete = useCallback(async () => {
    if (!id) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("Delete this announcement? This cannot be undone.");
      if (!ok) return;
    }
    setBusy(true);
    const res = await apiSend(`/api/announcements/${id}`, "DELETE");
    setBusy(false);
    if (res.success) {
      router.push("/console/announcements");
    }
  }, [id, router]);

  return (
    <div>
      <ModuleHeader
        title="Announcement"
        action={
          <Link
            href="/console/announcements"
            className="text-sm text-accent hover:underline"
          >
            Back to all
          </Link>
        }
      />

      <div className="mt-6">
        {loading ? (
          <div className="rounded-lg border border-ink/10 bg-white p-8 text-center text-sm text-ink/40">
            Loading announcement...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-white p-8 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-3 rounded border border-ink/10 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              Try again
            </button>
          </div>
        ) : announcement ? (
          <AnnouncementView
            announcement={announcement}
            isAdmin={isAdmin}
            onPublish={onPublish}
            onDelete={onDelete}
            busy={busy}
          />
        ) : null}
      </div>
    </div>
  );
}
