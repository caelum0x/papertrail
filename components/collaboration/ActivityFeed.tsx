"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getJson,
  displayName,
  initials,
  labelForVerb,
  timeAgo,
  type ActivityView,
  type CollabEntityType,
} from "./client";

interface ActivityFeedProps {
  // Optional scoping — when provided, the feed is filtered to one entity. Omit
  // for the org-wide feed used on the activity page.
  entityType?: CollabEntityType;
  entityId?: string;
  actorId?: string;
  verb?: string;
  limit?: number;
  // Compact mode drops the header and page-size chrome for embedding in a panel.
  compact?: boolean;
  title?: string;
}

function buildQuery(props: ActivityFeedProps, page: number): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(props.limit ?? 20));
  if (props.entityType) params.set("entity_type", props.entityType);
  if (props.entityId) params.set("entity_id", props.entityId);
  if (props.actorId) params.set("actor_id", props.actorId);
  if (props.verb) params.set("verb", props.verb);
  return `/api/activity?${params.toString()}`;
}

// A short human sentence describing an activity item, e.g. "Ada commented on a
// claim". Falls back gracefully for unknown verbs/entities.
function describe(item: ActivityView): string {
  const who = displayName(item.actorName, item.actorEmail);
  const article = indefiniteArticle(item.entityType);
  return `${who} ${labelForVerb(item.verb)} ${article}${item.entityType}`;
}

function indefiniteArticle(word: string): string {
  return /^[aeiou]/i.test(word) ? "an " : "a ";
}

// A reusable, paginated activity list. Renders loading / empty / error states.
// Used both on the org activity page and embedded (compact) on entity views.
export default function ActivityFeed(props: ActivityFeedProps) {
  const { compact = false, title = "Activity" } = props;
  const [items, setItems] = useState<ActivityView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = props.limit ?? 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<ActivityView[]>(buildQuery(props, page));
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load activity.");
      return;
    }
    setItems(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    page,
    props.entityType,
    props.entityId,
    props.actorId,
    props.verb,
    props.limit,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {!compact ? (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
            <p className="mt-1 text-sm text-ink/40">
              Comments, replies, and annotations across your organization.
            </p>
          </div>
        </div>
      ) : (
        <h3 className="text-sm font-medium text-ink/70">{title}</h3>
      )}

      <div
        className={`${
          compact ? "mt-3" : "mt-6"
        } bg-white border border-ink/10 rounded-lg overflow-hidden`}
      >
        {loading ? (
          <div className="p-5 text-sm text-ink/40">Loading activity…</div>
        ) : error ? (
          <div className="p-5 text-sm text-red-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-5 text-sm text-ink/40">No activity yet.</div>
        ) : (
          <ul className="divide-y divide-ink/10">
            {items.map((item) => (
              <li
                key={item.id}
                className="px-5 py-3 flex items-start gap-3"
              >
                <div
                  className="w-7 h-7 shrink-0 rounded-full bg-paper border border-ink/10 flex items-center justify-center text-[10px] font-medium text-ink/60"
                  aria-hidden="true"
                >
                  {initials(item.actorName, item.actorEmail)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink/80">{describe(item)}</div>
                  <div className="text-[11px] text-ink/35 mt-0.5">
                    {timeAgo(item.createdAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!compact && totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="text-ink/60 hover:text-accent disabled:text-ink/25"
          >
            Previous
          </button>
          <span className="text-ink/40">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="text-ink/60 hover:text-accent disabled:text-ink/25"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
