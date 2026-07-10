"use client";

import { useMemo } from "react";
import { funnelPlotData, type StudyEffect as BiasStudyEffect } from "@/lib/publicationBias";
import { FunnelPlot, type FunnelPoint, type FunnelCiBound } from "@/components/synthesis/FunnelPlot";
import { HeterogeneityBar } from "@/components/synthesis/HeterogeneityBar";
import type { MetaAnalysisResult } from "./types";

// Publication-bias / heterogeneity visuals for the Evidence Workbench. The engines
// have already produced the numbers (report.pooled); this panel only re-projects the
// pooled studies onto the log scale that the funnel plot draws on, using the SAME
// deterministic funnelPlotData helper the API path uses. NO number is re-estimated
// here — the log transform is the identical closed form metaAnalysis applies
// internally (yi = ln(point); se = (ln(ciUpper) - ln(ciLower)) / (2 * 1.96)).

interface BiasVizPanelProps {
  pooled: MetaAnalysisResult;
}

// Two-sided z for the 95% CI the workbench studies carry. Matches metaAnalysis's
// convention for converting a reported ratio CI back to a log-scale variance.
const Z_95 = 1.959963984540054;

// Convert one pooled ratio study (point + 95% CI on the ratio scale) to the log
// StudyEffect the bias engine consumes. Returns null when the CI is degenerate
// (non-positive or zero-width) so a bad row can't poison the variance.
function toBiasEffect(s: {
  label: string;
  point: number;
  ciLower: number;
  ciUpper: number;
}): BiasStudyEffect | null {
  if (!(s.point > 0 && s.ciLower > 0 && s.ciUpper > 0)) return null;
  const yi = Math.log(s.point);
  const se = (Math.log(s.ciUpper) - Math.log(s.ciLower)) / (2 * Z_95);
  const vi = se * se;
  if (!Number.isFinite(yi) || !Number.isFinite(vi) || vi <= 0) return null;
  return { label: s.label, yi, vi };
}

export function BiasVizPanel({ pooled }: BiasVizPanelProps) {
  // Pooled effect on the log scale is ln(random point) — the vertical funnel line.
  const funnel = useMemo(() => {
    const effects = pooled.studies
      .map(toBiasEffect)
      .filter((e): e is BiasStudyEffect => e !== null);
    if (effects.length === 0) return null;
    const pooledLogEffect = Math.log(pooled.random.point);
    if (!Number.isFinite(pooledLogEffect)) return null;
    return funnelPlotData(effects, pooledLogEffect);
  }, [pooled]);

  const points = useMemo<FunnelPoint[]>(
    () =>
      funnel
        ? funnel.studies.map((s) => ({
            label: s.label,
            effect: s.effect,
            standardError: s.standardError,
          }))
        : [],
    [funnel]
  );

  const ciBounds = useMemo<FunnelCiBound[]>(
    () => (funnel ? funnel.ciBounds.map((b) => ({ se: b.se, lower: b.lower, upper: b.upper })) : []),
    [funnel]
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">
          Funnel plot (small-study effects)
        </h4>
        {funnel && points.length >= 1 ? (
          <FunnelPlot
            measure={pooled.measure}
            pooledEffect={funnel.pooledLogEffect}
            studies={points}
            ciBounds={ciBounds}
          />
        ) : (
          <p className="text-sm text-ink/40">Not enough usable studies to draw a funnel.</p>
        )}
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">
          Heterogeneity
        </h4>
        <HeterogeneityBar iSquared={pooled.heterogeneity.iSquared} />
        <p className="mt-2 text-xs leading-relaxed text-ink/40">
          I² is the share of total variability across studies attributable to
          between-study heterogeneity rather than chance. Cochrane thresholds at 25 / 50 / 75.
        </p>
      </div>
    </div>
  );
}
