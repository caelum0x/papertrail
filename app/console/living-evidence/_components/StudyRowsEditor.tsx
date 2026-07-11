"use client";

// Editable list of study rows (label, measure, year, point estimate + 95% CI).
// Used for both the baseline body and the single candidate row. Immutable updates
// only — every change produces a new array via the onChange callback.

import type { RatioMeasure, StudyInput } from "./types";

const MEASURES: RatioMeasure[] = ["RR", "HR", "OR"];

export function makeEmptyStudy(year: number): StudyInput {
  return { label: "", measure: "RR", year, point: null, ciLower: null, ciUpper: null };
}

function numOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface RowProps {
  study: StudyInput;
  index: number;
  onChange: (index: number, next: StudyInput) => void;
  onRemove?: (index: number) => void;
}

function StudyRow({ study, index, onChange, onRemove }: RowProps) {
  const update = (patch: Partial<StudyInput>) => onChange(index, { ...study, ...patch });

  return (
    <div className="grid grid-cols-12 gap-2">
      <input
        aria-label="Study label"
        placeholder="Study label"
        value={study.label}
        onChange={(e) => update({ label: e.target.value })}
        className="col-span-4 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      />
      <select
        aria-label="Measure"
        value={study.measure}
        onChange={(e) => update({ measure: e.target.value as RatioMeasure })}
        className="col-span-2 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      >
        {MEASURES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input
        aria-label="Year"
        type="number"
        placeholder="Year"
        value={Number.isFinite(study.year) ? study.year : ""}
        onChange={(e) => update({ year: Math.trunc(Number(e.target.value) || 0) })}
        className="col-span-2 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      />
      <input
        aria-label="Point estimate"
        type="number"
        step="0.01"
        placeholder="Est."
        value={study.point ?? ""}
        onChange={(e) => update({ point: numOrNull(e.target.value) })}
        className="col-span-1 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      />
      <input
        aria-label="CI lower"
        type="number"
        step="0.01"
        placeholder="Lo"
        value={study.ciLower ?? ""}
        onChange={(e) => update({ ciLower: numOrNull(e.target.value) })}
        className="col-span-1 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      />
      <input
        aria-label="CI upper"
        type="number"
        step="0.01"
        placeholder="Hi"
        value={study.ciUpper ?? ""}
        onChange={(e) => update({ ciUpper: numOrNull(e.target.value) })}
        className="col-span-1 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      />
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove study"
          onClick={() => onRemove(index)}
          className="col-span-12 text-left text-xs text-red-700 hover:underline sm:col-span-12"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

interface EditorProps {
  studies: StudyInput[];
  onChange: (next: StudyInput[]) => void;
}

export function StudyRowsEditor({ studies, onChange }: EditorProps) {
  const updateRow = (index: number, next: StudyInput) =>
    onChange(studies.map((s, i) => (i === index ? next : s)));

  const removeRow = (index: number) => onChange(studies.filter((_, i) => i !== index));

  const addRow = () => {
    const nextYear =
      studies.length > 0 ? Math.max(...studies.map((s) => s.year)) + 1 : new Date().getFullYear();
    onChange([...studies, makeEmptyStudy(nextYear)]);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 text-xs uppercase tracking-wide text-ink/40">
        <span className="col-span-4">Label</span>
        <span className="col-span-2">Measure</span>
        <span className="col-span-2">Year</span>
        <span className="col-span-1">Est.</span>
        <span className="col-span-1">Lo</span>
        <span className="col-span-1">Hi</span>
      </div>
      {studies.map((study, i) => (
        <StudyRow key={i} study={study} index={i} onChange={updateRow} onRemove={removeRow} />
      ))}
      <button
        type="button"
        onClick={addRow}
        className="text-sm text-accent hover:underline"
      >
        + Add study
      </button>
    </div>
  );
}
