"use client";

import Link from "next/link";
import { NotificationsHeader } from "./_components/NotificationsHeader";
import { NotificationList } from "./_components/NotificationList";
import { PrefsPanel } from "./_components/PrefsPanel";
import { useNotifications } from "./_components/useNotifications";

export default function NotificationsPage() {
  const {
    items,
    loading,
    error,
    unreadOnly,
    hasUnread,
    setUnreadOnly,
    onMarkRead,
    onMarkAll,
  } = useNotifications();

  return (
    <div>
      <NotificationsHeader
        title="Notifications"
        subtitle="Activity across your organization."
      >
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          className={`text-sm ${
            unreadOnly ? "text-accent font-medium" : "text-ink/60"
          } hover:underline`}
        >
          {unreadOnly ? "Showing unread" : "Show unread only"}
        </button>
        <button
          onClick={onMarkAll}
          disabled={!hasUnread}
          className="text-sm text-accent hover:underline disabled:text-ink/30 disabled:no-underline"
        >
          Mark all read
        </button>
        <Link
          href="/console/notifications/preferences"
          className="text-sm text-ink/60 hover:text-accent"
        >
          Preferences
        </Link>
      </NotificationsHeader>

      <NotificationList
        items={items}
        loading={loading}
        error={error}
        unreadOnly={unreadOnly}
        onMarkRead={onMarkRead}
      />

      <PrefsPanel />
    </div>
  );
}
