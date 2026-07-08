import type { JobStatus } from "@/lib/jobs/types";
import { statusClasses } from "./status";

// Pill badge showing a job's status with status-specific coloring.
export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${statusClasses(
        status
      )}`}
    >
      {status}
    </span>
  );
}
