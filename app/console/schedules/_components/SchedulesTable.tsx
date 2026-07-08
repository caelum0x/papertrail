import Link from "next/link";
import type { Schedule } from "@/lib/jobs/types";
import { formatTime } from "./client";

interface SchedulesTableProps {
  items: Schedule[];
  onToggle: (schedule: Schedule) => void;
  onDelete: (id: string) => void;
}

// Table of cron schedules with enable/disable and delete actions per row.
export function SchedulesTable({
  items,
  onToggle,
  onDelete,
}: SchedulesTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs text-ink/40">
          <th className="px-4 py-2 font-medium">Name</th>
          <th className="px-4 py-2 font-medium">Type</th>
          <th className="px-4 py-2 font-medium">Cron</th>
          <th className="px-4 py-2 font-medium">Enabled</th>
          <th className="px-4 py-2 font-medium">Last run</th>
          <th className="px-4 py-2 font-medium">Next run</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((s) => (
          <ScheduleRow
            key={s.id}
            schedule={s}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </tbody>
    </table>
  );
}

function ScheduleRow({
  schedule: s,
  onToggle,
  onDelete,
}: {
  schedule: Schedule;
  onToggle: (schedule: Schedule) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <tr className="border-b border-ink/10 last:border-0">
      <td className="px-4 py-2 text-ink/80">
        <Link
          href={`/console/schedules/${s.id}`}
          className="text-accent hover:underline"
        >
          {s.name}
        </Link>
      </td>
      <td className="px-4 py-2 font-mono text-xs text-ink/80">{s.type}</td>
      <td className="px-4 py-2 font-mono text-xs text-ink/60">{s.cron}</td>
      <td className="px-4 py-2">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
            s.enabled
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-ink/15 bg-paper text-ink/50"
          }`}
        >
          {s.enabled ? "enabled" : "disabled"}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-ink/50">{formatTime(s.lastRunAt)}</td>
      <td className="px-4 py-2 text-xs text-ink/50">{formatTime(s.nextRunAt)}</td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-3">
          <button
            onClick={() => onToggle(s)}
            className="text-xs text-accent hover:underline"
          >
            {s.enabled ? "Disable" : "Enable"}
          </button>
          <button
            onClick={() => onDelete(s.id)}
            className="text-xs text-red-700 hover:underline"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
