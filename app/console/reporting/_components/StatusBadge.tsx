import type { RunStatus } from "@/lib/reporting/types";
import { statusStyle } from "./format";

interface StatusBadgeProps {
  status: RunStatus;
}

// Small pill rendering a run's status with a status-specific color.
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle(
        status
      )}`}
    >
      {status}
    </span>
  );
}
