"use client";

// Reusable, self-contained banner that surfaces the single most recent unread
// published announcement for the active org. Drop it into any console page or
// layout: it fetches on mount, renders nothing when there's nothing unread, and
// marks the announcement read (dismissing it) when the user acts.
//
// It leans on the module's client api helpers (which forward x-org-id) so it
// never needs the caller to wire anything up.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  apiGet,
  apiSend,
  type AnnouncementDto,
} from "@/app/console/announcements/api";
import { KindBadge } from "./KindBadge";

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<AnnouncementDto | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    // The list endpoint returns published items with the caller's read state;
    // the first unread one is the banner candidate.
    const res = await apiGet<AnnouncementDto[]>(
      "/api/announcements?published=1&limit=20"
    );
    if (res.success && res.data) {
      const unread = res.data.find((a) => a.read === false);
      setAnnouncement(unread ?? null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onDismiss = useCallback(async () => {
    if (!announcement) return;
    setDismissed(true);
    // Best-effort: marking read persists the dismissal across sessions.
    await apiSend(`/api/announcements/${announcement.id}/read`, "POST").catch(
      () => undefined
    );
  }, [announcement]);

  if (!announcement || dismissed) return null;

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KindBadge kind={announcement.kind} />
            <p className="truncate text-sm font-medium text-ink/80">
              {announcement.title}
            </p>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-ink/60">
            {announcement.body}
          </p>
          <Link
            href={`/console/announcements/${announcement.id}`}
            className="mt-1 inline-block text-xs text-accent hover:underline"
            onClick={onDismiss}
          >
            Read more
          </Link>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss announcement"
          className="shrink-0 rounded px-2 py-1 text-sm text-ink/40 hover:text-ink/70"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
