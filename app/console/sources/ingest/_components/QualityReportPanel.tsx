"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import type { QualityReport } from "./types";
import { SOURCE_OPTIONS } from "./types";

// Read-only quality panel over the shared `sources` cache: per-source_type document counts
// and ingest-time entity-coverage stats. Fetches the public /api/sources/quality-report on
// mount and exposes a manual refresh so the numbers can be re-pulled after an ingest run.

const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((o) => [o.id, o.label])
);

function labelFor(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType;
}

interface QualityReportPanelProps {
  // Bumped by the parent after a successful ingest to trigger a re-fetch.
  refreshKey: number;
}

export function QualityReportPanel({ refreshKey }: QualityReportPanelProps) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sources/quality-report", { method: "GET" });
      const body = (await res.json().catch(() => null)) as
        | ApiResponse<QualityReport>
        | null;
      if (!body) throw new Error("Unexpected server response.");
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Failed to load the source quality report.");
      }
      setReport(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the quality report.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink/70">Cache quality report</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-ink/15 bg-paper px-3 py-1.5 text-xs text-ink/60 hover:text-ink disabled:opacity-40"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {loading && !report ? (
          <LoadingBanner message="Aggregating the cached corpus and entity coverage…" />
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        {report ? <ReportView report={report} /> : null}
      </div>
    </section>
  );
}

function ReportView({ report }: { report: QualityReport }) {
  const { entityCoverage } = report;
  const coveragePct = Math.round(entityCoverage.coverageRatio * 100);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Cached documents" value={report.totalDocuments} />
        <Stat
          label="Entity coverage"
          value={`${coveragePct}%`}
          tone="accent"
          hint={`${entityCoverage.documentsWithEntities}/${report.totalDocuments} documents linked`}
        />
        <Stat
          label="Distinct entities"
          value={entityCoverage.distinctCanonicalEntities}
          hint={`${entityCoverage.totalEntityLinks} total links`}
        />
      </div>

      {!report.entityTablePresent ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Entity-linking store not yet provisioned — coverage stats will populate once the
          ingest migration has been applied.
        </p>
      ) : null}

      {/* Per-source_type counts */}
      <div>
        <h3 className="text-xs font-medium text-ink/60">Documents by database</h3>
        {report.perSourceType.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink/15 text-ink/40">
                  <th className="py-1.5 pr-3 font-medium">Database</th>
                  <th className="py-1.5 pr-3 font-medium">Documents</th>
                </tr>
              </thead>
              <tbody>
                {report.perSourceType.map((row) => (
                  <tr
                    key={row.source_type}
                    className="border-b border-ink/15 last:border-0"
                  >
                    <td className="py-1.5 pr-3 text-ink/80">{labelFor(row.source_type)}</td>
                    <td className="py-1.5 pr-3 text-ink/70">{row.document_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-1 text-xs text-ink/50">The cache is empty — run an ingest above.</p>
        )}
      </div>

      {/* Entities per ontology */}
      {entityCoverage.perOntology.length > 0 ? (
        <div>
          <h3 className="text-xs font-medium text-ink/60">Canonical entities by ontology</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entityCoverage.perOntology.map((o) => (
              <span
                key={o.ontology}
                className="rounded border border-ink/15 bg-paper px-2 py-0.5 text-xs text-ink/70"
              >
                {o.ontology}
                <span className="ml-1 text-ink/40">{o.entity_count}</span>
              </span>
            ))}
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
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "accent";
  hint?: string;
}) {
  const valueClass = tone === "accent" ? "text-accent" : "text-ink/80";
  return (
    <div className="rounded-lg border border-ink/15 bg-paper p-3">
      <p className="text-xs text-ink/40">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink/40">{hint}</p> : null}
    </div>
  );
}
