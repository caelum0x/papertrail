"use client";

import Link from "next/link";
import type { ScheduledReport } from "@/lib/reporting/types";
import { formatDate } from "./format";

interface ScheduledListProps {
  schedules: ScheduledReport[];
  canEdit: boolean;
  busyId: string | null;
  onToggle: (schedule: ScheduledReport) => void;
  onDelete: (schedule: ScheduledReport) => void;
}

// Table of the org's scheduled reports. Editors can enable/disable or remove a
// schedule inline; the parent page owns the mutation calls.
export function ScheduledList({
  schedules,
  canEdit,
  busyId,
  onToggle,
  onDelete,
}: ScheduledListProps) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Report</th>
          <th className="px-4 py-2 font-medium">Cron</th>
          <th className="px-4 py-2 font-medium">Recipients</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Created</th>
          {canEdit ? <th className="px-4 py-2 font-medium">Actions</th> : null}
        </tr>
      </thead>
      <tbody>
        {schedules.map((s) => (
          <tr key={s.id} className="border-t border-ink/10 hover:bg-paper">
            <td className="px-4 py-3">
              <Link
                href={`/console/reporting/${s.definitionId}`}
                className="font-medium text-ink/80 hover:text-accent"
              >
                {s.definitionName ?? "Untitled report"}
              </Link>
            </td>
            <td className="px-4 py-3 font-mono text-xs text-ink/60">{s.cron}</td>
            <td className="px-4 py-3 text-ink/60">
              {s.recipients.length} recipient
              {s.recipients.length === 1 ? "" : "s"}
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  s.enabled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-ink/10 text-ink/60"
                }`}
              >
                {s.enabled ? "enabled" : "disabled"}
              </span>
            </td>
            <td className="px-4 py-3 text-ink/50">{formatDate(s.createdAt)}</td>
            {canEdit ? (
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(s)}
                    disabled={busyId === s.id}
                    className="text-xs text-accent hover:underline disabled:opacity-40"
                  >
                    {s.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(s)}
                    disabled={busyId === s.id}
                    className="text-xs text-red-700 hover:underline disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
