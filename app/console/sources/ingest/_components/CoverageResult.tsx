"use client";

import { useMemo } from "react";
import type { MultiSourceIngestResult, SourceIngestResult } from "./types";
import { SOURCE_OPTIONS } from "./types";

// Renders the outcome of a single multi-source ingest run: per-source coverage counts,
// linked-entity totals, how many rows were freshly fetched vs served from cache (the
// cache-everything moat made visible), and how many ungrounded documents were dropped.

interface CoverageResultProps {
  result: MultiSourceIngestResult;
}

const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((o) => [o.id, o.label])
);

function labelFor(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType;
}

interface Totals {
  documents: number;
  cachedHits: number;
  freshlyFetched: number;
  entitiesLinked: number;
}

function summarize(ingested: readonly SourceIngestResult[]): Totals {
  return ingested.reduce<Totals>(
    (acc, r) => ({
      documents: acc.documents + 1,
      cachedHits: acc.cachedHits + (r.cached ? 1 : 0),
      freshlyFetched: acc.freshlyFetched + (r.cached ? 0 : 1),
      entitiesLinked: acc.entitiesLinked + r.entitiesLinked,
    }),
    { documents: 0, cachedHits: 0, freshlyFetched: 0, entitiesLinked: 0 }
  );
}

export function CoverageResult({ result }: CoverageResultProps) {
  const totals = useMemo(() => summarize(result.ingested), [result.ingested]);

  const coverageRows = useMemo(
    () =>
      Object.entries(result.coverage)
        .map(([source_type, count]) => ({ source_type, count }))
        .sort((a, b) => b.count - a.count || a.source_type.localeCompare(b.source_type)),
    [result.coverage]
  );

  return (
    <div className="space-y-4">
      {/* Run summary */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Documents" value={totals.documents} />
        <Stat label="From cache" value={totals.cachedHits} tone="emerald" />
        <Stat label="Newly fetched" value={totals.freshlyFetched} />
        <Stat label="Entities linked" value={totals.entitiesLinked} tone="accent" />
      </div>

      {result.droppedUngrounded > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {result.droppedUngrounded} ungrounded document
          {result.droppedUngrounded === 1 ? " was" : "s were"} dropped — nothing that could
          not be grounded was cached.
        </p>
      ) : null}

      {/* Per-source coverage */}
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink/70">Coverage by database</h3>
        {coverageRows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink/15 text-ink/40">
                  <th className="py-1.5 pr-3 font-medium">Database</th>
                  <th className="py-1.5 pr-3 font-medium">Documents ingested</th>
                </tr>
              </thead>
              <tbody>
                {coverageRows.map((row) => (
                  <tr
                    key={row.source_type}
                    className="border-b border-ink/15 last:border-0"
                  >
                    <td className="py-1.5 pr-3 text-ink/80">{labelFor(row.source_type)}</td>
                    <td className="py-1.5 pr-3 text-ink/70">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink/50">
            No documents were ingested for this input.
          </p>
        )}
      </div>

      {/* Per-document detail */}
      {result.ingested.length > 0 ? (
        <div className="rounded-lg border border-ink/15 bg-white p-4">
          <h3 className="text-sm font-semibold text-ink/70">Ingested documents</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink/15 text-ink/40">
                  <th className="py-1.5 pr-3 font-medium">Database</th>
                  <th className="py-1.5 pr-3 font-medium">External id</th>
                  <th className="py-1.5 pr-3 font-medium">Source</th>
                  <th className="py-1.5 pr-3 font-medium">Entities linked</th>
                </tr>
              </thead>
              <tbody>
                {result.ingested.map((r) => (
                  <tr
                    key={`${r.source_type}:${r.external_id}`}
                    className="border-b border-ink/15 last:border-0"
                  >
                    <td className="py-1.5 pr-3 text-ink/80">{labelFor(r.source_type)}</td>
                    <td className="py-1.5 pr-3">
                      <code className="text-ink/70">{r.external_id}</code>
                    </td>
                    <td className="py-1.5 pr-3">
                      {r.cached ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          cache
                        </span>
                      ) : (
                        <span className="rounded-full border border-ink/15 bg-paper px-2 py-0.5 text-[11px] font-medium text-ink/60">
                          fetched
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-ink/70">{r.entitiesLinked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "accent";
}) {
  const valueClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "accent"
        ? "text-accent"
        : "text-ink/80";
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-3">
      <p className="text-xs text-ink/40">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
