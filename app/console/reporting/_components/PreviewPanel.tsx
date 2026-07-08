"use client";

import type {
  LayoutSection,
  ReportFilter,
  ReportResult,
  ReportType,
} from "@/lib/reporting/types";
import { typeLabel } from "./format";
import { ResultView } from "./ResultView";

interface PreviewPanelProps {
  name: string;
  type: ReportType;
  sections: LayoutSection[];
  filters: ReportFilter[];
  since: string;
  result: ReportResult | null;
  running: boolean;
  saved: boolean;
  onRun: () => void;
}

// Right-hand preview in the builder. Before a report is saved it shows a
// structural preview (name, type, sections, filter summary). Once saved, an
// editor can compose a live preview run whose result renders below.
export function PreviewPanel({
  name,
  type,
  sections,
  filters,
  since,
  result,
  running,
  saved,
  onRun,
}: PreviewPanelProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/80">Preview</h2>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink/50">Name</dt>
          <dd className="text-ink/80">{name.trim() || "Untitled report"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink/50">Type</dt>
          <dd className="text-ink/80">{typeLabel(type)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink/50">Sections</dt>
          <dd className="text-ink/80">{sections.length}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink/50">Filters</dt>
          <dd className="text-ink/80">
            {filters.length}
            {since ? ` · since ${since}` : ""}
          </dd>
        </div>
      </dl>

      {sections.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {sections.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded border border-ink/10 bg-paper px-2 py-1 text-xs"
            >
              <span className="text-ink/70">{s.title || "Untitled section"}</span>
              <span className="text-ink/40">{s.kind}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 border-t border-ink/10 pt-4">
        {saved ? (
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {running ? "Composing..." : "Run preview"}
          </button>
        ) : (
          <p className="text-xs text-ink/40">
            Save the report to compose a live preview from your org's data.
          </p>
        )}
      </div>

      {result ? (
        <div className="mt-4">
          <ResultView result={result} />
        </div>
      ) : null}
    </div>
  );
}
