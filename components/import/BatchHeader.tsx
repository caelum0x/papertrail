import Link from "next/link";
import type { ImportBatch } from "@/lib/import/types";
import { BatchStatusBadge } from "./ImportStatusBadge";

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded border border-ink/10 bg-paper px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-ink/40">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone ?? "text-ink/80"}`}>
        {value}
      </div>
    </div>
  );
}

// Detail-view header: batch identity, status, counts, and a commit action passed
// in by the parent (which owns the mutation state).
export function BatchHeader({
  batch,
  committing,
  onCommit,
}: {
  batch: ImportBatch;
  committing: boolean;
  onCommit: () => void;
}) {
  const canCommit = batch.status === "pending" || batch.status === "failed";
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/console/import" className="text-xs text-accent hover:underline">
            ← All imports
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold text-ink/80">
            {batch.target}
            <span className="text-xs uppercase text-ink/40">{batch.format}</span>
            <BatchStatusBadge status={batch.status} />
          </h1>
        </div>
        {canCommit ? (
          <button
            type="button"
            onClick={onCommit}
            disabled={committing}
            className="shrink-0 rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {committing ? "Committing…" : batch.status === "failed" ? "Retry commit" : "Commit import"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Total rows" value={batch.total} />
        <Stat label="Succeeded" value={batch.succeeded} tone="text-emerald-700" />
        <Stat label="Failed" value={batch.failed} tone="text-red-700" />
      </div>

      {batch.error ? (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {batch.error}
        </p>
      ) : null}
    </div>
  );
}
