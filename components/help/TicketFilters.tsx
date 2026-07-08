"use client";

// Status/priority facet + subject search for the ticket list. Controlled by the
// parent page. Presentational only.
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  type TicketStatus,
  type TicketPriority,
} from "@/app/console/help/api";

const STATUSES: TicketStatus[] = ["open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export function TicketFilters({
  status,
  priority,
  search,
  onStatus,
  onPriority,
  onSearch,
}: {
  status: TicketStatus | null;
  priority: TicketPriority | null;
  search: string;
  onStatus: (next: TicketStatus | null) => void;
  onPriority: (next: TicketPriority | null) => void;
  onSearch: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={status ?? ""}
        onChange={(e) => onStatus((e.target.value || null) as TicketStatus | null)}
        className="text-sm bg-white border border-ink/10 rounded px-2 py-1.5 text-ink/70 outline-none focus:border-accent"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <select
        value={priority ?? ""}
        onChange={(e) =>
          onPriority((e.target.value || null) as TicketPriority | null)
        }
        className="text-sm bg-white border border-ink/10 rounded px-2 py-1.5 text-ink/70 outline-none focus:border-accent"
        aria-label="Filter by priority"
      >
        <option value="">All priorities</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>

      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search subjects..."
        className="flex-1 min-w-[10rem] text-sm bg-white border border-ink/10 rounded px-3 py-1.5 text-ink/80 outline-none focus:border-accent placeholder:text-ink/40"
        aria-label="Search ticket subjects"
      />
    </div>
  );
}
