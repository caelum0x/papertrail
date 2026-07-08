"use client";

// A single row in the announcement list: title, kind badge, publish state, and
// an unread dot. Links to the detail view. Admin actions (publish/delete) are
// surfaced inline when the caller passes handlers.
import Link from "next/link";
import {
  formatDate,
  AUDIENCE_LABELS,
  type AnnouncementDto,
} from "@/app/console/announcements/api";
import { KindBadge } from "./KindBadge";

export function AnnouncementRow({
  announcement,
  isAdmin,
  onPublish,
  onDelete,
  busy,
}: {
  announcement: AnnouncementDto;
  isAdmin: boolean;
  onPublish?: (id: string) => void;
  onDelete?: (id: string) => void;
  busy?: boolean;
}) {
  const isDraft = announcement.publishedAt === null;
  const unread = announcement.read === false;

  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink/10 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {unread && !isDraft ? (
            <span
              aria-label="Unread"
              className="h-2 w-2 shrink-0 rounded-full bg-accent"
            />
          ) : null}
          <Link
            href={`/console/announcements/${announcement.id}`}
            className="truncate text-sm font-medium text-ink/80 hover:text-accent"
          >
            {announcement.title}
          </Link>
          <KindBadge kind={announcement.kind} />
          {isDraft ? (
            <span className="rounded-full border border-ink/20 px-2 py-0.5 text-xs text-ink/50">
              Draft
            </span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-1 text-sm text-ink/50">{announcement.body}</p>
        <p className="mt-1 text-xs text-ink/40">
          {isDraft
            ? `Created ${formatDate(announcement.createdAt)}`
            : `Published ${formatDate(announcement.publishedAt)}`}
          {" · "}
          {AUDIENCE_LABELS[announcement.audience]}
          {announcement.authorName ? ` · by ${announcement.authorName}` : ""}
        </p>
      </div>

      {isAdmin ? (
        <div className="flex shrink-0 items-center gap-2">
          {isDraft && onPublish ? (
            <button
              onClick={() => onPublish(announcement.id)}
              disabled={busy}
              className="rounded border border-accent/30 px-2 py-1 text-xs text-accent hover:bg-accent/5 disabled:opacity-40"
            >
              Publish
            </button>
          ) : null}
          {onDelete ? (
            <button
              onClick={() => onDelete(announcement.id)}
              disabled={busy}
              className="rounded border border-ink/10 px-2 py-1 text-xs text-ink/50 hover:text-red-600 disabled:opacity-40"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
