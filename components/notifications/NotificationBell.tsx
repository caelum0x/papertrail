"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getJson, sendJson } from "@/components/notifications/apiClient";
import {
  labelForType,
  timeAgo,
  type NotificationView,
} from "@/components/notifications/types";

// Compact notification bell for the console header. Polls the unread count and,
// when opened, shows the most recent notifications with a "mark all read"
// action. Fetches on mount and on an interval, so it is a client component.

const POLL_MS = 60_000;
const PREVIEW_LIMIT = 8;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const loadUnreadCount = useCallback(async () => {
    const res = await getJson<NotificationView[]>(
      "/api/notifications?unread=true&limit=1"
    );
    if (res.success) {
      setUnread(res.meta?.total ?? 0);
    }
  }, []);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<NotificationView[]>(
      `/api/notifications?limit=${PREVIEW_LIMIT}`
    );
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load notifications.");
      return;
    }
    setItems(res.data);
  }, []);

  useEffect(() => {
    loadUnreadCount();
    const timer = setInterval(loadUnreadCount, POLL_MS);
    return () => clearInterval(timer);
  }, [loadUnreadCount]);

  useEffect(() => {
    if (open) loadFeed();
  }, [open, loadFeed]);

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const onMarkAll = useCallback(async () => {
    const res = await sendJson<{ updated: number }>(
      "/api/notifications/read-all",
      "POST"
    );
    if (res.success) {
      setUnread(0);
      setItems((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
      );
    }
  }, []);

  const onOpenItem = useCallback(async (n: NotificationView) => {
    if (!n.readAt) {
      const res = await sendJson<NotificationView>(
        `/api/notifications/${n.id}/read`,
        "POST"
      );
      if (res.success) {
        setUnread((u) => Math.max(0, u - 1));
        setItems((prev) =>
          prev.map((x) =>
            x.id === n.id
              ? { ...x, readAt: x.readAt ?? new Date().toISOString() }
              : x
          )
        );
      }
    }
    setOpen(false);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-ink/60 hover:text-ink/80"
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-ink/15 rounded-lg shadow-sm z-20 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-ink/10 flex items-center justify-between">
            <span className="text-sm font-medium text-ink/70">
              Notifications
            </span>
            {unread > 0 ? (
              <button
                onClick={onMarkAll}
                className="text-xs text-accent hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-ink/40">Loading...</div>
            ) : error ? (
              <div className="p-4 text-sm text-red-600">{error}</div>
            ) : items.length === 0 ? (
              <div className="p-4 text-sm text-ink/40">You&apos;re all caught up.</div>
            ) : (
              <ul className="divide-y divide-ink/10">
                {items.map((n) => {
                  const inner = (
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {!n.readAt ? (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                            aria-hidden="true"
                          />
                        ) : null}
                        <span className="text-[11px] uppercase tracking-wide text-ink/40">
                          {labelForType(n.type)}
                        </span>
                        <span className="text-[11px] text-ink/35 ml-auto shrink-0">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-sm text-ink/80 truncate">
                        {n.title}
                      </div>
                      {n.body ? (
                        <div className="text-xs text-ink/50 line-clamp-2">
                          {n.body}
                        </div>
                      ) : null}
                    </div>
                  );
                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link
                          href={n.link}
                          onClick={() => onOpenItem(n)}
                          className="block px-4 py-3 hover:bg-paper"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          onClick={() => onOpenItem(n)}
                          className="block w-full text-left px-4 py-3 hover:bg-paper"
                        >
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="px-4 py-2 border-t border-ink/10 text-center">
            <Link
              href="/console/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-accent hover:underline"
            >
              View all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
