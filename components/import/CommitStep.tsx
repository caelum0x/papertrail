"use client";

import Link from "next/link";
import type { ImportBatch } from "@/lib/import/types";
import { BatchStatusBadge } from "./ImportStatusBadge";

// Step 4: the batch has been staged. Offer to commit it now (insert into the
// target table) or review it later from history. Parent owns the commit call.
export function CommitStep({
  batch,
  committing,
  committed,
  error,
  onCommit,
}: {
  batch: ImportBatch;
  committing: boolean;
  committed: boolean;
  error: string | null;
  onCommit: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-ink/10 bg-white p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink/80">Batch staged</h2>
          <BatchStatusBadge status={batch.status} />
        </div>
        <p className="mt-1 text-sm text-ink/60">
          {batch.total} row(s) ready to import into{" "}
          <span className="font-medium text-ink/80">{batch.target}</span>.
        </p>
        {committed ? (
          <p className="mt-2 text-sm text-emerald-700">
            Imported {batch.succeeded} row(s); {batch.failed} failed.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex justify-between">
        <Link
          href={`/console/import/${batch.id}`}
          className="rounded border border-ink/10 px-4 py-2 text-sm text-ink/60 hover:bg-paper"
        >
          View batch
        </Link>
        {!committed ? (
          <button
            type="button"
            onClick={onCommit}
            disabled={committing}
            className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {committing ? "Committing…" : "Commit now"}
          </button>
        ) : (
          <Link
            href="/console/import"
            className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90"
          >
            Done
          </Link>
        )}
      </div>
    </div>
  );
}
