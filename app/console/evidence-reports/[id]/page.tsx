"use client";

// Saved Evidence Report detail. GETs a single org-scoped report by id and renders
// the persisted composite (GRADE certainty, verdict, pooled stats, forest plot) by
// reusing the Evidence Workbench panels. The stored `report` jsonb is the full
// deterministic composite the engine produced; we render it verbatim and never
// recompute. Handles loading, 404, and 401/403 error states inline.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ForestPlot, type ForestStudy } from "@/components/synthesis/ForestPlot";
import { ModuleHeader } from "../../claims/_components/ModuleHeader";
import { CertaintyBadge } from "../../workbench/_components/CertaintyBadge";
import { VerdictBanner } from "../../workbench/_components/VerdictBanner";
import { PooledStatsPanel } from "../../workbench/_components/PooledStatsPanel";
import { AbsoluteEffectsPanel } from "../../workbench/_components/AbsoluteEffectsPanel";
import type { EvidenceReport } from "../../workbench/_components/types";
import { ReevaluatePanel } from "./_components/ReevaluatePanel";
import {
  apiGet,
  formatDateTime,
  type SavedEvidenceReportDto,
} from "../api";

// Narrow the opaque stored jsonb to the ok:true composite the panels expect. The
// engine always stores this shape; anything else falls back to a raw view.
function asEvidenceReport(value: Record<string, unknown>): EvidenceReport | null {
  if (value && value.ok === true && typeof value.pooled === "object") {
    return value as unknown as EvidenceReport;
  }
  return null;
}

export default function SavedEvidenceReportDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [record, setRecord] = useState<SavedEvidenceReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await apiGet<SavedEvidenceReportDto>(`/api/evidence-reports/${id}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load this report.");
      setRecord(null);
      setLoading(false);
      return;
    }
    setRecord(res.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = useMemo(
    () => (record ? asEvidenceReport(record.report) : null),
    [record]
  );

  const forestStudies = useMemo<ForestStudy[]>(() => {
    if (!report) return [];
    return report.pooled.studies.map((s) => ({
      label: s.label,
      point: s.point,
      ciLower: s.ciLower,
      ciUpper: s.ciUpper,
      weightPct: s.weightRandomPct,
    }));
  }, [report]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Saved evidence report"
        subtitle={record ? `Saved ${formatDateTime(record.createdAt)}` : undefined}
        action={
          <Link
            href="/console/evidence-reports"
            className="text-sm text-accent hover:underline"
          >
            ← All saved reports
          </Link>
        }
      />

      {loading ? (
        <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Loading report…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-sm font-medium text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : record ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-ink/40">Claim</div>
            <p className="mt-1 text-sm leading-relaxed text-ink/80">{record.claim}</p>
          </div>

          {id ? <ReevaluatePanel reportId={id} /> : null}

          {report ? (
            <>
              <CertaintyBadge certainty={report.certainty} />
              <VerdictBanner verdict={report.verdict} />

              <div className="rounded-lg border border-ink/15 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink/70">
                  Pooled estimates &amp; heterogeneity
                </h3>
                <PooledStatsPanel
                  pooled={report.pooled}
                  publicationBias={report.publicationBias}
                />
              </div>

              {report.absoluteEffects ? (
                <div className="rounded-lg border border-ink/15 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-ink/70">Absolute effects</h3>
                  <AbsoluteEffectsPanel effect={report.absoluteEffects} />
                </div>
              ) : null}

              <div className="rounded-lg border border-ink/15 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink/70">Forest plot</h3>
                <ForestPlot
                  measure={report.pooled.measure}
                  studies={forestStudies}
                  pooled={{
                    label: "Pooled (random)",
                    point: report.pooled.random.point,
                    ciLower: report.pooled.random.ciLower,
                    ciUpper: report.pooled.random.ciUpper,
                  }}
                  predictionInterval={report.pooled.predictionInterval}
                />
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-ink/20 bg-paper p-6">
              <h3 className="text-sm font-semibold text-ink/80">Stored report</h3>
              <p className="mt-2 text-sm text-ink/60">
                This saved report doesn&apos;t match the current composite format and can&apos;t be
                rendered as panels. Its raw contents are shown below.
              </p>
              <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-ink/10 bg-white p-3 text-xs text-ink/70">
                {JSON.stringify(record.report, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
