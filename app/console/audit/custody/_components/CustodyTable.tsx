"use client";

import { useCallback, useState } from "react";
import { recomputeCustodyHash } from "./verifyHash";
import type { ChainOfCustodyView, VerifyState } from "./types";

// Renders the chain-of-custody table for one verification and a per-row
// "verify hash" button that RECOMPUTES the hash in the browser from the row's
// provenance tuple and asserts it matches the server-supplied hash. This is the
// tamper-evidence proof: if any tuple field were altered, the recomputed hash
// would diverge and the row flips to "mismatch".

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

function fieldOrDash(value: string | null): string {
  return value && value.trim().length > 0 ? value : "—";
}

interface CustodyTableProps {
  custody: ChainOfCustodyView;
}

export function CustodyTable({ custody }: CustodyTableProps) {
  const [states, setStates] = useState<Record<number, VerifyState>>({});
  const [busy, setBusy] = useState(false);

  const verifyRow = useCallback(
    async (index: number) => {
      const record = custody.records[index];
      const recomputed = await recomputeCustodyHash({
        verification_id: record.verification_id,
        source_id: record.source_id,
        doi: record.doi,
        pmid: record.pmid,
        source_version: record.source_version,
        snapshot_date: record.snapshot_date,
        content_hash: record.content_hash,
        source_span: record.source_span,
        span_start: record.span_start,
        span_end: record.span_end,
      });
      const next: VerifyState =
        recomputed === record.chain_of_custody_hash ? "match" : "mismatch";
      setStates((prev) => ({ ...prev, [index]: next }));
    },
    [custody.records]
  );

  const verifyAll = useCallback(async () => {
    setBusy(true);
    try {
      await Promise.all(custody.records.map((_, i) => verifyRow(i)));
    } finally {
      setBusy(false);
    }
  }, [custody.records, verifyRow]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink/15 bg-paper p-4">
        <h3 className="text-sm font-semibold text-ink/70">Provenance envelope</h3>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink/40">Verification id</dt>
            <dd className="font-mono text-ink">{custody.verification_id}</dd>
          </div>
          <div>
            <dt className="text-ink/40">Source id</dt>
            <dd className="font-mono text-ink">{fieldOrDash(custody.source_id)}</dd>
          </div>
          <div>
            <dt className="text-ink/40">DOI / PMID</dt>
            <dd className="text-ink">
              {fieldOrDash(custody.doi)}
              {custody.pmid ? ` · PMID ${custody.pmid}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-ink/40">Source version</dt>
            <dd className="text-ink">{fieldOrDash(custody.source_version)}</dd>
          </div>
          <div>
            <dt className="text-ink/40">Snapshot date</dt>
            <dd className="text-ink">{fieldOrDash(custody.snapshot_date)}</dd>
          </div>
          <div>
            <dt className="text-ink/40">Content hash</dt>
            <dd className="font-mono text-ink">
              {custody.content_hash ? shortHash(custody.content_hash) : "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink/40">Aggregate custody hash</dt>
            <dd className="font-mono text-accent">{custody.aggregate_hash}</dd>
          </div>
        </dl>
        {custody.dropped_ungroundable > 0 ? (
          <p className="mt-3 text-xs text-amber-800">
            {custody.dropped_ungroundable} span
            {custody.dropped_ungroundable === 1 ? "" : "s"} could no longer be grounded
            against the current cached source and were dropped from the custody chain.
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink/70">
          Grounded spans ({custody.records.length})
        </h3>
        {custody.records.length > 0 ? (
          <button
            type="button"
            onClick={() => void verifyAll()}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify all hashes"}
          </button>
        ) : null}
      </div>

      {custody.records.length === 0 ? (
        <div className="rounded-lg border border-ink/15 bg-paper p-6 text-center text-sm text-ink/40">
          No grounded spans in this verification&apos;s chain of custody.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-ink/15">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink/40">
              <tr>
                <th className="px-3 py-2 font-medium">Grounded span</th>
                <th className="px-3 py-2 font-medium">Offsets</th>
                <th className="px-3 py-2 font-medium">Custody hash</th>
                <th className="px-3 py-2 font-medium">Verify</th>
              </tr>
            </thead>
            <tbody>
              {custody.records.map((record, i) => {
                const state = states[i] ?? "unchecked";
                return (
                  <tr key={record.chain_of_custody_hash} className="border-t border-ink/15">
                    <td className="max-w-md px-3 py-2 text-ink">
                      <span className="line-clamp-3">{record.source_span}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-ink/70">
                      {record.span_start}–{record.span_end}
                    </td>
                    <td className="px-3 py-2 font-mono text-ink/70">
                      {shortHash(record.chain_of_custody_hash)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void verifyRow(i)}
                        className="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs font-medium text-ink hover:border-accent"
                      >
                        Verify
                      </button>
                      {state === "match" ? (
                        <span className="ml-2 text-xs font-medium text-emerald-800">
                          ✓ matches
                        </span>
                      ) : state === "mismatch" ? (
                        <span className="ml-2 text-xs font-medium text-red-700">
                          ✗ tampered
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
