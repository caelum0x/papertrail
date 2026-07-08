import { statusStyle } from "./shared";

interface StatusBadgeProps {
  status: string;
}

// Small colored pill for an export's status (pending / processing / complete /
// failed). Colors come from the shared STATUS_STYLES map.
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusStyle(status)}`}
    >
      {status}
    </span>
  );
}
