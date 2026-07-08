"use client";

import { TARGET_FIELDS, type ImportTarget } from "@/lib/import/types";

// Step 2: wire each target field to a source column. Required fields must be
// mapped before advancing. Controlled by the parent wizard.
export function MappingStep({
  target,
  columns,
  mapping,
  onMap,
  onBack,
  onNext,
}: {
  target: ImportTarget;
  columns: string[];
  mapping: Record<string, string>;
  onMap: (fieldKey: string, column: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const fields = TARGET_FIELDS[target];
  const missingRequired = fields
    .filter((f) => f.required)
    .filter((f) => !mapping[f.key]);
  const canNext = missingRequired.length === 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink/60">
        Map each <span className="font-medium text-ink/80">{target}</span> field to
        a column from your file. Required fields are marked with{" "}
        <span className="text-red-600">*</span>.
      </p>

      <div className="divide-y divide-ink/10 rounded-lg border border-ink/10 bg-white">
        {fields.map((field) => (
          <div
            key={field.key}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="text-sm">
              <span className="text-ink/80">{field.label}</span>
              {field.required ? <span className="text-red-600"> *</span> : null}
              <div className="text-xs text-ink/40">{field.key}</div>
            </div>
            <select
              value={mapping[field.key] ?? ""}
              onChange={(e) => onMap(field.key, e.target.value)}
              className={
                "w-56 rounded border px-2 py-1.5 text-sm " +
                (field.required && !mapping[field.key]
                  ? "border-red-300 bg-red-50"
                  : "border-ink/10 bg-white")
              }
            >
              <option value="">— not mapped —</option>
              {columns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {!canNext ? (
        <p className="text-sm text-red-600">
          Map required field(s): {missingRequired.map((f) => f.label).join(", ")}.
        </p>
      ) : null}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-ink/10 px-4 py-2 text-sm text-ink/60 hover:bg-paper"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          Next: preview
        </button>
      </div>
    </div>
  );
}
