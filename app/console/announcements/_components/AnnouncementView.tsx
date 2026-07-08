"use client";

// Full detail view of a single announcement: kind badge, title, meta line, and
// the full body. Presentational — the page owns fetching and the read side
// effect. Admin-only actions (publish a draft, delete) render when handlers
// are supplied.
import {
  formatDate,
  AUDIENCE_LABELS,
  type AnnouncementDto,
} from "../api";
import { KindBadge } from "@/components/announcements/KindBadge";

export function AnnouncementView({
  announcement,
  isAdmin,
  onPublish,
  onDelete,
  busy,
}: {
  announcement: AnnouncementDto;
  isAdmin: boolean;
  onPublish?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const isDraft = announcement.publishedAt === null;

  return (
    <article className="rounded-lg border border-ink/10 bg-white p-6">
      <div className="flex items-center gap-2">
        <KindBadge kind={announcement.kind} />
        {isDraft ? (
          <span className="rounded-full border border-ink/20 px-2 py-0.5 text-xs text-ink/50">
            Draft
          </span>
        ) : null}
      </div>

      <h1 className="mt-3 text-xl font-semibold text-ink/80">
        {announcement.title}
      </h1>

      <p className="mt-1 text-xs text-ink/40">
        {isDraft
          ? `Created ${formatDate(announcement.createdAt)}`
          : `Published ${formatDate(announcement.publishedAt)}`}
        {" · "}
        {AUDIENCE_LABELS[announcement.audience]}
        {announcement.authorName ? ` · by ${announcement.authorName}` : ""}
      </p>

      <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">
        {announcement.body}
      </div>

      {isAdmin && (onPublish || onDelete) ? (
        <div className="mt-6 flex items-center gap-2 border-t border-ink/10 pt-4">
          {isDraft && onPublish ? (
            <button
              onClick={onPublish}
              disabled={busy}
              className="rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-40"
            >
              Publish
            </button>
          ) : null}
          {onDelete ? (
            <button
              onClick={onDelete}
              disabled={busy}
              className="rounded border border-ink/10 px-3 py-2 text-sm text-ink/60 hover:text-red-600 disabled:opacity-40"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
