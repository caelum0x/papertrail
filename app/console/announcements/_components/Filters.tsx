"use client";

// Filter bar for the announcement list: free-text search + kind filter. Admins
// additionally get a drafts/published toggle. Purely controlled by the parent.
import {
  ANNOUNCEMENT_KIND_OPTIONS,
  type AnnouncementKind,
} from "../api";

export function Filters({
  search,
  onSearch,
  kind,
  onKind,
  isAdmin,
  publishedOnly,
  onPublishedOnly,
}: {
  search: string;
  onSearch: (v: string) => void;
  kind: AnnouncementKind | "";
  onKind: (v: AnnouncementKind | "") => void;
  isAdmin: boolean;
  publishedOnly: boolean;
  onPublishedOnly: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search announcements..."
        className="w-64 rounded border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 placeholder:text-ink/30 focus:border-accent focus:outline-none"
      />
      <select
        value={kind}
        onChange={(e) => onKind(e.target.value as AnnouncementKind | "")}
        className="rounded border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
      >
        <option value="">All kinds</option>
        {ANNOUNCEMENT_KIND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {isAdmin ? (
        <label className="flex items-center gap-2 text-sm text-ink/60">
          <input
            type="checkbox"
            checked={publishedOnly}
            onChange={(e) => onPublishedOnly(e.target.checked)}
          />
          Published only
        </label>
      ) : null}
    </div>
  );
}
