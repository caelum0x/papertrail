"use client";

// Shared studies editor used by the synthesis, evidence-report, and workbench
// consoles. Renders the header row and one editable row per study (label, ratio
// measure, point estimate, CI bounds, and — where the layout asks for it — a CI
// percent). Every edit produces a fresh study object via onChange; this component
// never mutates the study it is given.
//
// The three consoles differ only in grid geometry, header wording, per-row chrome,
// and remove-button style. Those differences are captured in a StudyEditorLayout
// whose column values are COMPLETE, literal Tailwind class strings (so Tailwind's
// content scanner sees them) — the exact visuals of each page are preserved while
// the row/header markup is written once.
//
// The "+ Add study" control is intentionally NOT part of this component: each page
// places it in its own action row alongside a different primary button.

import type { ReactNode } from "react";

// The minimal ratio measure vocabulary every console shares.
export type StudyMeasure = "RR" | "HR" | "OR";

// The subset of a study-form row this editor reads and writes. Consoles may carry
// extra fields on their own form type; those pass through untouched because updates
// are produced by spreading the original study.
export interface EditableStudy {
  id: string;
  label: string;
  measure: StudyMeasure;
  point: string;
  ciLower: string;
  ciUpper: string;
  // Optional: only the synthesis and evidence-report consoles expose a CI% column.
  ciPct?: string;
}

// Complete, literal Tailwind col-span class strings for one column. `row` is the
// span applied to the input in the study row (visible at every breakpoint, e.g.
// "col-span-3 sm:col-span-1"); `header` is the span applied to that column's header
// cell (hidden below sm on most columns, e.g. "sm:col-span-1"). Both must be literal
// so Tailwind's content scanner emits them. `header` is optional for the label
// column, whose header always uses the row span.
interface ColumnClasses {
  row: string;
  header?: string;
}

export interface StudyEditorLayout {
  columns: {
    label: ColumnClasses;
    measure: ColumnClasses;
    point: ColumnClasses;
    ciLower: ColumnClasses;
    ciUpper: ColumnClasses;
    // Present only when the page shows a CI% column.
    ciPct?: ColumnClasses;
    remove: ColumnClasses;
  };
  headers: {
    ciLower: string; // "CI lower" vs "CI lo"
    ciUpper: string; // "CI upper" vs "CI hi"
  };
  // "framed": bordered rows, cells wrapped in spanning <div>s, a text "Remove"
  // button (synthesis + workbench). "compact": borderless rows, span classes on the
  // controls themselves, a "×" remove button (evidence-report).
  variant: "framed" | "compact";
}

const MEASURES: StudyMeasure[] = ["RR", "HR", "OR"];

const INPUT =
  "w-full rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none";

interface StudyRowProps<T extends EditableStudy> {
  study: T;
  index: number;
  canRemove: boolean;
  layout: StudyEditorLayout;
  onChange: (next: T) => void;
  onRemove: () => void;
}

function StudyRow<T extends EditableStudy>({
  study,
  index,
  canRemove,
  layout,
  onChange,
  onRemove,
}: StudyRowProps<T>) {
  const set = (patch: Partial<EditableStudy>) => onChange({ ...study, ...patch });
  const { columns, variant } = layout;
  const framed = variant === "framed";

  const rowClass = framed
    ? "grid grid-cols-12 items-center gap-2 border-t border-ink/10 py-2"
    : "mt-2 grid grid-cols-12 items-center gap-2";

  // In the framed variant each control is wrapped in a spanning <div>; in the
  // compact variant the control itself carries the span classes. cell() renders
  // the right container so a single set of controls serves both variants.
  const cell = (col: ColumnClasses, control: (className: string) => ReactNode) =>
    framed ? <div className={col.row}>{control(INPUT)}</div> : control(`${col.row} ${INPUT}`);

  return (
    <div className={rowClass}>
      {cell(columns.label, (cn) => (
        <input
          aria-label={`Study ${index + 1} label`}
          className={cn}
          placeholder={`Trial ${index + 1}`}
          value={study.label}
          onChange={(e) => set({ label: e.target.value })}
        />
      ))}
      {cell(columns.measure, (cn) => (
        <select
          aria-label={`Study ${index + 1} measure`}
          className={cn}
          value={study.measure}
          onChange={(e) => set({ measure: e.target.value as StudyMeasure })}
        >
          {MEASURES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ))}
      {cell(columns.point, (cn) => (
        <input
          aria-label={`Study ${index + 1} point estimate`}
          className={cn}
          inputMode="decimal"
          placeholder="0.75"
          value={study.point}
          onChange={(e) => set({ point: e.target.value })}
        />
      ))}
      {cell(columns.ciLower, (cn) => (
        <input
          aria-label={`Study ${index + 1} CI lower`}
          className={cn}
          inputMode="decimal"
          placeholder="0.60"
          value={study.ciLower}
          onChange={(e) => set({ ciLower: e.target.value })}
        />
      ))}
      {cell(columns.ciUpper, (cn) => (
        <input
          aria-label={`Study ${index + 1} CI upper`}
          className={cn}
          inputMode="decimal"
          placeholder="0.94"
          value={study.ciUpper}
          onChange={(e) => set({ ciUpper: e.target.value })}
        />
      ))}
      {columns.ciPct
        ? cell(columns.ciPct, (cn) => (
            <input
              aria-label={`Study ${index + 1} CI percent`}
              className={cn}
              inputMode="decimal"
              placeholder="95"
              value={study.ciPct ?? ""}
              onChange={(e) => set({ ciPct: e.target.value })}
            />
          ))
        : null}
      <div className={`${columns.remove.row} flex justify-end`}>
        {framed ? (
          <button
            type="button"
            aria-label={`Remove study ${index + 1}`}
            disabled={!canRemove}
            onClick={onRemove}
            className="rounded-md px-2 py-1 text-sm text-ink/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            className="text-ink/30 hover:text-red-600 disabled:opacity-30"
            aria-label={`Remove study ${index + 1}`}
            title="Remove study"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

interface StudyEditorProps<T extends EditableStudy> {
  studies: readonly T[];
  layout: StudyEditorLayout;
  // Minimum number of rows that must remain — drives the remove-disabled state.
  minRows?: number;
  onChange: (next: T) => void;
  onRemove: (id: string) => void;
}

export function StudyEditor<T extends EditableStudy>({
  studies,
  layout,
  minRows = 2,
  onChange,
  onRemove,
}: StudyEditorProps<T>) {
  const { columns, headers } = layout;
  const canRemove = studies.length > minRows;

  return (
    <div className="mt-4">
      <div className="grid grid-cols-12 gap-2 text-xs font-medium uppercase tracking-wide text-ink/40">
        <div className={columns.label.header ?? columns.label.row}>Study</div>
        <div className={`hidden sm:block ${columns.measure.header ?? ""}`}>Measure</div>
        <div className={`hidden sm:block ${columns.point.header ?? ""}`}>Point</div>
        <div className={`hidden sm:block ${columns.ciLower.header ?? ""}`}>{headers.ciLower}</div>
        <div className={`hidden sm:block ${columns.ciUpper.header ?? ""}`}>{headers.ciUpper}</div>
        {columns.ciPct ? (
          <div className={`hidden sm:block ${columns.ciPct.header ?? ""}`}>CI %</div>
        ) : null}
        <div className={`hidden sm:block ${columns.remove.header ?? ""}`} />
      </div>
      {studies.map((row, i) => (
        <StudyRow
          key={row.id}
          study={row}
          index={i}
          canRemove={canRemove}
          layout={layout}
          onChange={onChange}
          onRemove={() => onRemove(row.id)}
        />
      ))}
    </div>
  );
}
