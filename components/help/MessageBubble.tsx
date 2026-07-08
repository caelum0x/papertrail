"use client";

// One message in a ticket thread. Highlights the current user's own messages.
import type { TicketMessageDto } from "@/app/console/help/api";

export function MessageBubble({
  message,
  isMine,
}: {
  message: TicketMessageDto;
  isMine: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        isMine ? "border-accent/30 bg-accent/5" : "border-ink/10 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-ink/70">
          {isMine ? "You" : message.authorName || message.authorEmail || "Unknown"}
        </span>
        <span className="text-xs text-ink/40">
          {new Date(message.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink/70 whitespace-pre-wrap">{message.body}</p>
    </div>
  );
}
