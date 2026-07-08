"use client";

// Detail header for a single ticket. Shows subject, author, badges, and — for
// editors — inline status/priority controls that PATCH the ticket. The parent
// owns the ticket state and applies the returned update via onUpdated.
import {
  apiSend,
  STATUS_LABELS,
  PRIORITY_LABELS,
  type SupportTicketDto,
  type TicketStatus,
  type TicketPriority,
} from "@/app/console/help/api";
import { StatusBadge, PriorityBadge } from "./StatusBadge";

const STATUSES: TicketStatus[] = ["open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export function TicketHeader({
  ticket,
  canManage,
  onUpdated,
  onError,
}: {
  ticket: SupportTicketDto;
  canManage: boolean;
  onUpdated: (t: SupportTicketDto) => void;
  onError: (msg: string) => void;
}) {
  async function patch(patchBody: {
    status?: TicketStatus;
    priority?: TicketPriority;
  }) {
    const res = await apiSend<SupportTicketDto>(
      `/api/support/tickets/${ticket.id}`,
      "PATCH",
      patchBody
    );
    if (!res.success || !res.data) {
      onError(res.error ?? "Failed to update ticket.");
      return;
    }
    onUpdated(res.data);
  }

  return (
    <div className="bg-white border border-ink/10 rounded-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink/80 break-words">
            {ticket.subject}
          </h1>
          <p className="mt-1 text-xs text-ink/40">
            Opened by {ticket.authorName || ticket.authorEmail || "Unknown"} on{" "}
            {new Date(ticket.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      <p className="mt-4 text-sm text-ink/70 whitespace-pre-wrap">{ticket.body}</p>

      {canManage ? (
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-ink/10 pt-4">
          <label className="flex items-center gap-2 text-xs text-ink/50">
            Status
            <select
              value={ticket.status}
              onChange={(e) => void patch({ status: e.target.value as TicketStatus })}
              className="text-sm bg-paper border border-ink/10 rounded px-2 py-1 text-ink/70 outline-none focus:border-accent"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink/50">
            Priority
            <select
              value={ticket.priority}
              onChange={(e) =>
                void patch({ priority: e.target.value as TicketPriority })
              }
              className="text-sm bg-paper border border-ink/10 rounded px-2 py-1 text-ink/70 outline-none focus:border-accent"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
