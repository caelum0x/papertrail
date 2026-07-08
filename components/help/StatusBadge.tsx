// Small colored pills for ticket status and priority. Presentational only.
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  type TicketStatus,
  type TicketPriority,
} from "@/app/console/help/api";

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-accent/10 text-accent",
  pending: "bg-amber-100 text-amber-700",
  resolved: "bg-emerald-100 text-emerald-700",
  closed: "bg-ink/10 text-ink/50",
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low: "bg-ink/5 text-ink/50",
  normal: "bg-ink/10 text-ink/60",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`inline-block text-xs rounded px-2 py-0.5 ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span
      className={`inline-block text-xs rounded px-2 py-0.5 ${PRIORITY_STYLES[priority]}`}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
