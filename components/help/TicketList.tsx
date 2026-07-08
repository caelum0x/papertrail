"use client";

// The ticket list table: renders loading / error / empty states, then a list of
// TicketRow components. Filtering + pagination live in the parent page.
import type { SupportTicketDto } from "@/app/console/help/api";
import { TicketRow } from "./TicketRow";
import { EmptyState } from "./EmptyState";

export function TicketList({
  tickets,
  loading,
  error,
  onRetry,
}: {
  tickets: SupportTicketDto[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return <p className="text-sm text-ink/40">Loading tickets...</p>;
  }
  if (error) {
    return (
      <div className="bg-white border border-ink/10 rounded-lg p-5">
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={onRetry} className="mt-2 text-sm text-accent">
          Retry
        </button>
      </div>
    );
  }
  if (tickets.length === 0) {
    return (
      <EmptyState
        title="No tickets match these filters."
        hint="Open a new ticket or clear the filters."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {tickets.map((t) => (
        <li key={t.id}>
          <TicketRow ticket={t} />
        </li>
      ))}
    </ul>
  );
}
