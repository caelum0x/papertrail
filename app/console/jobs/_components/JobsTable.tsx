import Link from "next/link";
import type { Job } from "@/lib/jobs/types";
import { StatusBadge } from "./StatusBadge";
import { formatTime } from "./status";

interface JobsTableProps {
  items: Job[];
  onRetry: (id: string) => void;
}

// Table of queued/running/finished jobs with a retry action per finished row.
export function JobsTable({ items, onRetry }: JobsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs text-ink/40">
          <th className="px-4 py-2 font-medium">Type</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Attempts</th>
          <th className="px-4 py-2 font-medium">Run after</th>
          <th className="px-4 py-2 font-medium">Updated</th>
          <th className="px-4 py-2 font-medium">Error</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((job) => (
          <JobRow key={job.id} job={job} onRetry={onRetry} />
        ))}
      </tbody>
    </table>
  );
}

function JobRow({ job, onRetry }: { job: Job; onRetry: (id: string) => void }) {
  return (
    <tr className="border-b border-ink/10 last:border-0">
      <td className="px-4 py-2 font-mono text-xs text-ink/80">
        <Link
          href={`/console/jobs/${job.id}`}
          className="text-accent hover:underline"
        >
          {job.type}
        </Link>
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={job.status} />
      </td>
      <td className="px-4 py-2 text-ink/60">
        {job.attempts}/{job.maxAttempts}
      </td>
      <td className="px-4 py-2 text-xs text-ink/50">
        {formatTime(job.runAfter)}
      </td>
      <td className="px-4 py-2 text-xs text-ink/50">
        {formatTime(job.updatedAt)}
      </td>
      <td className="max-w-[16rem] truncate px-4 py-2 text-xs text-red-700">
        {job.error ?? ""}
      </td>
      <td className="px-4 py-2 text-right">
        {job.status === "failed" || job.status === "completed" ? (
          <button
            onClick={() => onRetry(job.id)}
            className="text-xs text-accent hover:underline"
          >
            Retry
          </button>
        ) : null}
      </td>
    </tr>
  );
}
