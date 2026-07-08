"use client";

import {
  REPORT_TYPES,
  type ReportType,
} from "@/lib/reports-exports/schemas";
import { TYPE_LABELS } from "./shared";

interface CreateReportFormProps {
  name: string;
  reportType: ReportType;
  creating: boolean;
  formError: string | null;
  onNameChange: (name: string) => void;
  onTypeChange: (type: ReportType) => void;
  onSubmit: (e: React.FormEvent) => void;
}

// "Save a report" card. Rendered only for editor+ roles by the caller.
export function CreateReportForm({
  name,
  reportType,
  creating,
  formError,
  onNameChange,
  onTypeChange,
  onSubmit,
}: CreateReportFormProps) {
  return (
    <section className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/80">Save a report</h2>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink/60">
          Name
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Q3 flagged verifications"
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Data
          <select
            value={reportType}
            onChange={(e) => onTypeChange(e.target.value as ReportType)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
          >
            {REPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm font-medium text-ink/80 hover:bg-paper disabled:opacity-40"
        >
          {creating ? "Saving…" : "Save report"}
        </button>
      </form>
      {formError ? (
        <p className="mt-2 text-xs text-red-700">{formError}</p>
      ) : null}
    </section>
  );
}
