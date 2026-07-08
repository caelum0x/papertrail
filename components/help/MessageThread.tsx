"use client";

// The conversation thread for a ticket. Renders each reply as a MessageBubble,
// oldest first, with an empty state when no one has replied yet.
import type { TicketMessageDto } from "@/app/console/help/api";
import { MessageBubble } from "./MessageBubble";

export function MessageThread({
  messages,
  currentUserId,
}: {
  messages: TicketMessageDto[];
  currentUserId: string | null;
}) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-ink/40">
        No replies yet. Add the first response below.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          isMine={currentUserId !== null && m.authorId === currentUserId}
        />
      ))}
    </div>
  );
}
