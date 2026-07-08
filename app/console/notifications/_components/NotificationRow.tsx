import Link from "next/link";
import { labelForType, timeAgo, type NotificationView } from "@/components/notifications/types";

interface NotificationRowProps {
  notification: NotificationView;
  onMarkRead: (id: string) => void;
}

// A single notification list item: unread dot, type label, relative time,
// title/body, an optional deep link, and a "Mark read" action while unread.
export function NotificationRow({ notification: n, onMarkRead }: NotificationRowProps) {
  const inner = (
    <div className="min-w-0 flex-1">
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
        <span className="text-[11px] text-ink/35">· {timeAgo(n.createdAt)}</span>
      </div>
      <div className="mt-0.5 text-sm text-ink/80">{n.title}</div>
      {n.body ? (
        <div className="text-xs text-ink/50 mt-0.5">{n.body}</div>
      ) : null}
    </div>
  );

  return (
    <li className="px-5 py-3 flex items-start justify-between gap-4">
      {n.link ? (
        <Link
          href={n.link}
          onClick={() => onMarkRead(n.id)}
          className="min-w-0 flex-1 hover:opacity-80"
        >
          {inner}
        </Link>
      ) : (
        inner
      )}
      {!n.readAt ? (
        <button
          onClick={() => onMarkRead(n.id)}
          className="text-xs text-accent hover:underline shrink-0 mt-0.5"
        >
          Mark read
        </button>
      ) : null}
    </li>
  );
}
