import type { NotificationView } from "@/components/notifications/types";
import { NotificationRow } from "./NotificationRow";

interface NotificationListProps {
  items: NotificationView[];
  loading: boolean;
  error: string | null;
  unreadOnly: boolean;
  onMarkRead: (id: string) => void;
}

// The notifications feed card, handling loading / error / empty / list states.
export function NotificationList({
  items,
  loading,
  error,
  unreadOnly,
  onMarkRead,
}: NotificationListProps) {
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading notifications...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : items.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">
          {unreadOnly
            ? "No unread notifications."
            : "You have no notifications yet."}
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {items.map((n) => (
            <NotificationRow key={n.id} notification={n} onMarkRead={onMarkRead} />
          ))}
        </ul>
      )}
    </div>
  );
}
