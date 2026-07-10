"use client";

// Deterministic funnel plot rendered as pure SVG — no chart library. Each study
// is one point at (effect, standard error); the y-axis is INVERTED so precise
// studies (low SE) sit at the top near the funnel apex and imprecise ones fall to
// the wide base. The two diagonal lines are the pseudo-95% CI funnel edges
// (pooled +/- 1.96*se) and the vertical line marks the pooled effect. In the
// absence of small-study effects the points scatter symmetrically inside the
// funnel; points spilling out of one side hint at asymmetry / publication bias.
// Every coordinate comes straight from lib/publicationBias.ts funnelPlotData —
// nothing here re-estimates anything.

const INK = "#111318";
const ACCENT = "#C4522A";

// One study on the plotted (log or ratio) scale. Mirrors the FunnelStudy fields
// produced by funnelPlotData: `effect` is yi, `standardError` is sqrt(vi).
export interface FunnelPoint {
  label: string;
  effect: number;
  standardError: number;
}

// One funnel edge sample: the pseudo-95% CI half-width at a given SE. Mirrors the
// `ciBounds` entries from funnelPlotData (sorted widest-SE first, apex at se = 0).
export interface FunnelCiBound {
  se: number;
  lower: number;
  upper: number;
}

interface FunnelPlotProps {
  measure: string; // "RR" | "HR" | "OR", shown on the axis label
  pooledEffect: number; // pooledLogEffect (the vertical reference line)
  studies: readonly FunnelPoint[];
  ciBounds: readonly FunnelCiBound[]; // funnel edges from funnelPlotData
}

const TOP_PAD = 18;
const BOTTOM_AXIS = 52;
const LEFT_AXIS = 52; // room for the SE tick labels
const RIGHT_PAD = 18;
const PLOT_WIDTH = 380;
const PLOT_HEIGHT = 300;
const POINT_R = 4;

export function FunnelPlot({ measure, pooledEffect, studies, ciBounds }: FunnelPlotProps) {
  const plotLeft = LEFT_AXIS;
  const plotRight = LEFT_AXIS + PLOT_WIDTH;
  const plotTop = TOP_PAD;
  const plotBottom = TOP_PAD + PLOT_HEIGHT;
  const totalWidth = plotRight + RIGHT_PAD;
  const totalHeight = plotBottom + BOTTOM_AXIS;

  // Horizontal (effect) domain: bracket every study, every funnel edge and the
  // pooled line, then pad ~8% so nothing touches the frame.
  const effectValues = [
    pooledEffect,
    ...studies.map((s) => s.effect),
    ...ciBounds.map((b) => b.lower),
    ...ciBounds.map((b) => b.upper),
  ].filter((v) => Number.isFinite(v));
  const rawMinX = effectValues.length ? Math.min(...effectValues) : pooledEffect - 1;
  const rawMaxX = effectValues.length ? Math.max(...effectValues) : pooledEffect + 1;
  const xSpanRaw = rawMaxX - rawMinX || 1;
  const xPad = xSpanRaw * 0.08;
  const minX = rawMinX - xPad;
  const maxX = rawMaxX + xPad;
  const xSpan = maxX - minX || 1;

  // Vertical (standard error) domain, INVERTED: se = 0 at the top (apex), max SE
  // at the base. Include a little headroom so the apex line is visible.
  const seValues = [
    ...studies.map((s) => s.standardError),
    ...ciBounds.map((b) => b.se),
  ].filter((v) => Number.isFinite(v) && v >= 0);
  const maxSe = seValues.length ? Math.max(...seValues) : 1;
  const seDomain = maxSe > 0 ? maxSe * 1.05 : 1;

  const xOf = (effect: number): number =>
    plotLeft + ((effect - minX) / xSpan) * PLOT_WIDTH;
  // se = 0 → plotTop, se = seDomain → plotBottom.
  const yOf = (se: number): number =>
    plotTop + (Math.max(se, 0) / seDomain) * PLOT_HEIGHT;

  const pooledX = xOf(pooledEffect);

  // Build the two funnel edges as polylines from apex (se = 0) to the base. Sort
  // a copy by SE ascending so the polyline runs apex → base regardless of the
  // caller's ordering (funnelPlotData sorts widest-first).
  const sortedBounds = [...ciBounds].sort((a, b) => a.se - b.se);
  const leftEdge = sortedBounds.map((b) => `${xOf(b.lower)},${yOf(b.se)}`).join(" ");
  const rightEdge = sortedBounds.map((b) => `${xOf(b.upper)},${yOf(b.se)}`).join(" ");

  // A handful of SE ticks on the y-axis (apex at 0, base at seDomain).
  const seTickCount = 4;
  const seTicks = Array.from({ length: seTickCount + 1 }, (_, i) => (seDomain * i) / seTickCount);

  // Five effect ticks across the x-axis.
  const xTickCount = 4;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => minX + (xSpan * i) / xTickCount);

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      width="100%"
      role="img"
      aria-label={`Funnel plot of ${studies.length} studies around a pooled ${measure} effect of ${pooledEffect.toFixed(3)} (log scale); points outside the funnel suggest asymmetry`}
      className="max-w-full"
    >
      <title>Funnel plot — effect vs standard error with pseudo-95% CI funnel</title>

      {/* Plot frame. */}
      <rect
        x={plotLeft}
        y={plotTop}
        width={PLOT_WIDTH}
        height={PLOT_HEIGHT}
        fill="none"
        stroke={INK}
        strokeOpacity={0.12}
      />

      {/* Pseudo-95% CI funnel edges (apex → base). */}
      {sortedBounds.length >= 2 ? (
        <>
          <polyline points={leftEdge} fill="none" stroke={INK} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="4 3" />
          <polyline points={rightEdge} fill="none" stroke={INK} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="4 3" />
        </>
      ) : null}

      {/* Vertical pooled-effect reference line. */}
      <line
        x1={pooledX}
        y1={plotTop}
        x2={pooledX}
        y2={plotBottom}
        stroke={ACCENT}
        strokeOpacity={0.7}
        strokeWidth={1.5}
      />

      {/* Study points. */}
      {studies.map((s, i) => {
        const cx = xOf(s.effect);
        const cy = yOf(s.standardError);
        // A point is "outside" the funnel when it falls past the CI edge at its SE.
        const edge = sortedBounds.reduce<FunnelCiBound | null>((closest, b) => {
          if (closest === null) return b;
          return Math.abs(b.se - s.standardError) < Math.abs(closest.se - s.standardError) ? b : closest;
        }, null);
        const outside = edge ? s.effect < edge.lower || s.effect > edge.upper : false;
        return (
          <circle
            key={`${s.label}-${i}`}
            cx={cx}
            cy={cy}
            r={POINT_R}
            fill={outside ? ACCENT : INK}
            fillOpacity={outside ? 0.85 : 0.6}
            stroke={outside ? ACCENT : "none"}
            strokeOpacity={0.9}
          >
            <title>
              {s.label}: effect {s.effect.toFixed(3)}, SE {s.standardError.toFixed(3)}
              {outside ? " (outside funnel)" : ""}
            </title>
          </circle>
        );
      })}

      {/* Y-axis (standard error, inverted). */}
      <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} stroke={INK} strokeOpacity={0.4} />
      {seTicks.map((se, i) => {
        const y = yOf(se);
        return (
          <g key={`se-${i}`}>
            <line x1={plotLeft - 4} y1={y} x2={plotLeft} y2={y} stroke={INK} strokeOpacity={0.4} />
            <text x={plotLeft - 8} y={y + 3} textAnchor="end" fontSize={10} fill={INK} fillOpacity={0.55}>
              {se.toFixed(2)}
            </text>
          </g>
        );
      })}
      <text
        x={14}
        y={(plotTop + plotBottom) / 2}
        textAnchor="middle"
        fontSize={11}
        fill={INK}
        fillOpacity={0.5}
        transform={`rotate(-90 14 ${(plotTop + plotBottom) / 2})`}
      >
        Standard error
      </text>

      {/* X-axis (effect). */}
      <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke={INK} strokeOpacity={0.4} />
      {xTicks.map((t, i) => {
        const x = xOf(t);
        return (
          <g key={`x-${i}`}>
            <line x1={x} y1={plotBottom} x2={x} y2={plotBottom + 5} stroke={INK} strokeOpacity={0.4} />
            <text x={x} y={plotBottom + 18} textAnchor="middle" fontSize={10} fill={INK} fillOpacity={0.6}>
              {t.toFixed(2)}
            </text>
          </g>
        );
      })}
      <text
        x={(plotLeft + plotRight) / 2}
        y={plotBottom + 38}
        textAnchor="middle"
        fontSize={11}
        fill={INK}
        fillOpacity={0.5}
      >
        {measure} effect (log scale) — vertical line is the pooled estimate
      </text>
    </svg>
  );
}
