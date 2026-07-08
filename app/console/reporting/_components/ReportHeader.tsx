"use client";

import Link from "next/link";
import type { ReportDefinition, ReportFormat } from "@/lib/reporting/types";
import { typeLabel, formatDate } from "./format";

interface ReportHeaderProps {
  definition: ReportDefinition;
  canEdit: boolean;
  running: boolean;
  format: ReportFormat;
  onFormatChange: (format: ReportFormat) => void;
  onRun: () => void;
}

const FORMATS: ReportFormat[] = ["json", "csv", "html"];

// Detail-page header for a report definition: name, type, metadata, plus an
// editor-only "Run report" control with a format selector.
export function ReportHeader({
  definition,
  canEdit,
  running,
  format,
  onFormatChange,
  onRun,
}: ReportHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{definition.name}</h1>
        <p className="mt-1 text-sm text-ink/40">
          {typeLabel(definition.type)} · {definition.layout.sections.length}{" "}
          section{definition.layout.sections.length === 1 ? "" : "s"} · created{" "}
          {formatDate(definition.createdAt)}
        </p>
      </div>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Link
            href={`/console/reporting/builder?id=${definition.id}`}
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-paper"
          >
            Edit
          </Link>
          <select
            value={format}
            onChange={(e) => onFormatChange(e.target.value as ReportFormat)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm"
            aria-label="Run format"
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {running ? "Running..." : "Run report"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
