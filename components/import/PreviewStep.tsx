"use client";

import { TARGET_FIELDS, type ImportTarget } from "@/lib/import/types";

// Step 3: show the first N rows as they will land in the target table, applying
// the mapping. Read-only — the parent owns navigation and the create call.
const PREVIEW_LIMIT = 10;

export function PreviewStep({
  target,
  mapping,
  rows,
  totalRows,
  onBack,
  onConfirm,
  submitting,
  error,
}: {
  target: ImportTarget;
  mapping: Record<string, string>;
  rows: Record<string, string>[];
  totalRows: number;
  onBack: () => void;
  onConfirm: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const fields = TARGET_FIELDS[target].filter((f) => mapping[f.key]);
  const preview = rows.slice(0, PREVIEW_LIMIT);

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink/60">
        Showing {preview.length} of {totalRows} row(s) as they will map into{" "}
        <span className="font-medium text-ink/80">{target}</span>. Nothing is saved
        until you create the batch.
      </p>

      <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs uppercase tracking-wide text-ink/40">
            <tr>
              <th className="w-10 px-3 py-2 font-medium">#</th>
              {fields.map((f) => (
                <th key={f.key} className="px-3 py-2 font-medium">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} className="border-t border-ink/10 align-top">
                <td className="px-3 py-2 tabular-nums text-ink/40">{i + 1}</td>
                {fields.map((f) => {
                  const col = mapping[f.key];
                  const value = col ? (row[col] ?? "") : "";
                  return (
                    <td key={f.key} className="px-3 py-2 text-ink/80">
                      {value || <span className="text-ink/30">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
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
          onClick={onConfirm}
          disabled={submitting}
          className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create import batch"}
        </button>
      </div>
    </div>
  );
}
