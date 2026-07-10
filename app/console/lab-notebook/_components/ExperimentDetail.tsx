"use client";

import { StructuredRecord } from "./StructuredRecord";
import type { LabExperimentRecord } from "./types";

// Detail view of a saved experiment: the full grounded structured record plus the
// original raw notes it was derived from (collapsed by default), and a delete action.

interface ExperimentDetailProps {
  record: LabExperimentRecord | null;
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => void;
  deleting: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function ExperimentDetail({
  record,
  loading,
  error,
  onDelete,
  deleting,
}: ExperimentDetailProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-6 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
        Loading experiment…
      </div>
    );
  }

  if (!record) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
        Select a saved experiment to view its structured record.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink/80">{record.title}</h3>
          <p className="mt-0.5 text-xs text-ink/40">
            {record.experimentDate ? `${record.experimentDate} · ` : ""}
            saved {formatDate(record.createdAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDelete(record.id)}
          disabled={deleting}
          className="shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      {record.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {record.tags.map((t, i) => (
            <span
              key={`${t}-${i}`}
              className="rounded-full bg-ink/[0.05] px-2 py-0.5 text-xs text-ink/60"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-5 border-t border-ink/15 pt-4">
        <StructuredRecord structured={record.structured} />
      </div>

      <details className="mt-5 border-t border-ink/15 pt-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink/40">
          Original raw notes
        </summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-md bg-ink/[0.03] p-3 font-mono text-xs text-ink/70">
          {record.rawNotes}
        </pre>
      </details>
    </div>
  );
}
