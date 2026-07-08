"use client";

import {
  EXPORT_FORMATS,
  type ExportFormat,
} from "@/lib/reports-exports/schemas";
import type { Report } from "@/lib/reports-exports/types";
import { TYPE_LABELS } from "./shared";

interface RunReportCardProps {
  report: Report;
  canEdit: boolean;
  format: ExportFormat;
  exporting: boolean;
  exportMsg: string | null;
  exportErr: string | null;
  onFormatChange: (format: ExportFormat) => void;
  onRun: () => void;
}

// "Run this report" card on the report detail page: choose a format and export
// the report's scoped data.
export function RunReportCard({
  report,
  canEdit,
  format,
  exporting,
  exportMsg,
  exportErr,
  onFormatChange,
  onRun,
}: RunReportCardProps) {
  return (
    <section className="mt-6 rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/80">Run this report</h2>
      <p className="mt-1 text-xs text-ink/40">
        Exports the current {TYPE_LABELS[report.type].toLowerCase()} matching
        this report&apos;s scope.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Format
          <select
            value={format}
            onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
          >
            {EXPORT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f === "csv" ? "CSV" : "Markdown"}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={onRun}
          disabled={!canEdit || exporting}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          title={canEdit ? undefined : "Requires editor role or higher"}
        >
          {exporting ? "Exporting…" : "Export"}
        </button>
      </div>
      {exportMsg ? (
        <p className="mt-2 text-xs text-green-700">{exportMsg}</p>
      ) : null}
      {exportErr ? <p className="mt-2 text-xs text-red-700">{exportErr}</p> : null}
      {!canEdit ? (
        <p className="mt-2 text-xs text-ink/40">
          Your role can view this report but not run exports.
        </p>
      ) : null}
    </section>
  );
}
