"use client";

import {
  EXPORT_FORMATS,
  REPORT_TYPES,
  type ExportFormat,
  type ReportType,
} from "@/lib/reports-exports/schemas";
import { TYPE_LABELS } from "./shared";

interface ExportRunnerProps {
  canEdit: boolean;
  exportType: ReportType;
  exportFormat: ExportFormat;
  exporting: boolean;
  exportMsg: string | null;
  exportErr: string | null;
  onTypeChange: (type: ReportType) => void;
  onFormatChange: (format: ExportFormat) => void;
  onRun: () => void;
}

// "Run an export" card: pick data + format, then export. Role-gated on canEdit.
export function ExportRunner({
  canEdit,
  exportType,
  exportFormat,
  exporting,
  exportMsg,
  exportErr,
  onTypeChange,
  onFormatChange,
  onRun,
}: ExportRunnerProps) {
  return (
    <section className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/80">Run an export</h2>
      <p className="mt-1 text-xs text-ink/40">
        Generates a downloadable file from your organization&apos;s data and
        records the job in the history below.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Data
          <select
            value={exportType}
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
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Format
          <select
            value={exportFormat}
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
          Your role can view exports but not run them.
        </p>
      ) : null}
    </section>
  );
}
