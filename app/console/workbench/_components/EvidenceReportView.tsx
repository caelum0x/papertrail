"use client";

import { useMemo } from "react";
import { ForestPlot, type ForestStudy } from "@/components/synthesis/ForestPlot";
import { CertaintyBadge } from "./CertaintyBadge";
import { VerdictBanner } from "./VerdictBanner";
import { PooledStatsPanel } from "./PooledStatsPanel";
import { BiasVizPanel } from "./BiasVizPanel";
import { AbsoluteEffectsPanel } from "./AbsoluteEffectsPanel";
import { ConclusivenessPanel } from "./ConclusivenessPanel";
import { SaveReportButton } from "./SaveReportButton";
import type { EvidenceReportResult } from "./types";

// Shared renderer for a composite EvidenceReportResult. Both the manual/source-picker
// path and the auto-find pipeline path render through this so the deterministic stack
// (GRADE certainty, verdict, pooled estimates, publication bias, absolute effects,
// forest plot) looks identical no matter how the study set was assembled. Renders ONLY
// what the engines produced — no numbers are re-derived here.

interface EvidenceReportViewProps {
  report: EvidenceReportResult;
  // When true, offers the "persist to workspace" save control above the report.
  showSave?: boolean;
}

export function EvidenceReportView({ report, showSave = true }: EvidenceReportViewProps) {
  const forestStudies = useMemo<ForestStudy[]>(() => {
    if (!report.ok) return [];
    return report.pooled.studies.map((s) => ({
      label: s.label,
      point: s.point,
      ciLower: s.ciLower,
      ciUpper: s.ciUpper,
      weightPct: s.weightRandomPct,
    }));
  }, [report]);

  if (!report.ok) {
    return (
      <div className="rounded-lg border border-ink/20 bg-paper p-6">
        <h3 className="text-sm font-semibold text-ink/80">Insufficient evidence</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink/60">{report.reason}</p>
        <p className="mt-3 text-xs text-ink/40">
          Usable studies: {report.usableStudies}
          {report.claimedReductionPercent !== null
            ? ` · claimed reduction ${report.claimedReductionPercent}%`
            : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {showSave ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink/50">
            Persist this composite report to your workspace for later review and sharing.
          </p>
          <SaveReportButton claim={report.claim} report={report} />
        </div>
      ) : null}

      <CertaintyBadge certainty={report.certainty} />
      <VerdictBanner verdict={report.verdict} />

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink/70">Pooled estimates &amp; heterogeneity</h3>
        <PooledStatsPanel pooled={report.pooled} publicationBias={report.publicationBias} />
      </div>

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink/70">Publication bias &amp; heterogeneity</h3>
        <BiasVizPanel pooled={report.pooled} />
      </div>

      {report.absoluteEffects ? (
        <div className="rounded-lg border border-ink/15 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink/70">Absolute effects</h3>
          <AbsoluteEffectsPanel effect={report.absoluteEffects} />
        </div>
      ) : null}

      <ConclusivenessPanel report={report} />

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
    </div>
  );
}
