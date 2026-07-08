"use client";

// One row in the ticket list table. Links to the ticket detail view and shows
// subject, author, status/priority badges, message count, and created date.
import Link from "next/link";
import type { SupportTicketDto } from "@/app/console/help/api";
import { StatusBadge, PriorityBadge } from "./StatusBadge";

export function TicketRow({ ticket }: { ticket: SupportTicketDto }) {
  return (
    <Link
      href={`/console/help/tickets/${ticket.id}`}
      className="block bg-white border border-ink/10 rounded-lg p-4 hover:border-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink/80 truncate">{ticket.subject}</p>
          <p className="mt-0.5 text-xs text-ink/40">
            {ticket.authorName || ticket.authorEmail || "Unknown"} ·{" "}
            {new Date(ticket.createdAt).toLocaleDateString()}
            {typeof ticket.messageCount === "number"
              ? ` · ${ticket.messageCount} ${
                  ticket.messageCount === 1 ? "reply" : "replies"
                }`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status} />
        </div>
      </div>
    </Link>
  );
}
