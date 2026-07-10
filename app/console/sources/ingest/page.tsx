"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import { IngestControl, type IngestFormValue } from "./_components/IngestControl";
import { CoverageResult } from "./_components/CoverageResult";
import { QualityReportPanel } from "./_components/QualityReportPanel";
import type { MultiSourceIngestResult } from "./_components/types";

// Multi-source ingest console (Phase 2 — evidence integration). Run a multi-database ingest
// for a query and/or a canonical entity, then see the coverage result + per-document
// linked-entity counts, alongside a read-only quality report over the shared cache. Both
// routes are PUBLIC compute routes — the fetches carry no auth/org header.

// Build the request body the /api/ingest/multi-source route expects, omitting empty
// optional fields so the route's Zod refinements accept it.
function toRequestBody(value: IngestFormValue): Record<string, unknown> {
  const body: Record<string, unknown> = { limit: value.limit };
  if (value.query.length > 0) {
    body.query = value.query;
  }
  if (value.entitySurface.length > 0) {
    const entity: Record<string, unknown> = { surface: value.entitySurface };
    if (value.entityType.length > 0) {
      entity.type = value.entityType;
    }
    body.entity = entity;
  }
  if (value.sources.length > 0) {
    body.sources = value.sources;
  }
  return body;
}

export default function SourcesIngestPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MultiSourceIngestResult | null>(null);
  // Bumped after each successful ingest so the quality panel re-pulls the cache totals.
  const [reportKey, setReportKey] = useState(0);

  const run = useCallback(async (value: IngestFormValue) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ingest/multi-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRequestBody(value)),
      });
      const body = (await res.json().catch(() => null)) as
        | ApiResponse<MultiSourceIngestResult>
        | null;
      if (!body) throw new Error("Unexpected server response.");
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "The multi-source ingest failed.");
      }
      setResult(body.data);
      setReportKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run the multi-source ingest.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Multi-source ingest"
        subtitle="Pull PubMed, ClinicalTrials.gov, FAERS, ClinVar, ChEMBL, Open Targets, and PubTator into the shared cache with ingest-time entity canonicalization. Cache-first — already-cached documents are never re-fetched."
      />

      <IngestControl loading={loading} onRun={(v) => void run(v)} />

      {loading ? (
        <LoadingBanner message="Fanning out across the enabled databases and linking entities at ingest…" />
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      {result ? <CoverageResult result={result} /> : null}

      <QualityReportPanel refreshKey={reportKey} />
    </div>
  );
}
