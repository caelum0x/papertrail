"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson } from "@/components/notifications/apiClient";
import type { NotificationView } from "@/components/notifications/types";
import { PAGE_SIZE } from "./constants";

interface NotificationsState {
  items: NotificationView[];
  loading: boolean;
  error: string | null;
  unreadOnly: boolean;
  hasUnread: boolean;
  setUnreadOnly: (v: (prev: boolean) => boolean) => void;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
}

// Loads and mutates the org's notification feed against the existing
// /api/notifications endpoints, with an unread-only filter and mark-read /
// mark-all-read mutations applied optimistically.
export function useNotifications(): NotificationsState {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnlyState] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = `/api/notifications?limit=${PAGE_SIZE}${
      unreadOnly ? "&unread=true" : ""
    }`;
    const res = await getJson<NotificationView[]>(query);
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load notifications.");
      return;
    }
    setItems(res.data);
  }, [unreadOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const onMarkRead = useCallback(async (id: string) => {
    const res = await sendJson<NotificationView>(
      `/api/notifications/${id}/read`,
      "POST"
    );
    if (res.success) {
      setItems((prev) =>
        prev.map((n) =>
          n.id === id
            ? { ...n, readAt: n.readAt ?? new Date().toISOString() }
            : n
        )
      );
    }
  }, []);

  const onMarkAll = useCallback(async () => {
    const res = await sendJson<{ updated: number }>(
      "/api/notifications/read-all",
      "POST"
    );
    if (res.success) {
      if (unreadOnly) {
        setItems([]);
      } else {
        setItems((prev) =>
          prev.map((n) => ({
            ...n,
            readAt: n.readAt ?? new Date().toISOString(),
          }))
        );
      }
    }
  }, [unreadOnly]);

  const setUnreadOnly = useCallback(
    (v: (prev: boolean) => boolean) => setUnreadOnlyState(v),
    []
  );

  const hasUnread = items.some((n) => !n.readAt);

  return {
    items,
    loading,
    error,
    unreadOnly,
    hasUnread,
    setUnreadOnly,
    onMarkRead,
    onMarkAll,
  };
}
