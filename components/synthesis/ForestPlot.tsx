"use client";

// Deterministic forest plot rendered as pure SVG — no chart library. Every study
// gets one row: a square marker sized by its pooling weight, centered on its point
// estimate, with a horizontal confidence-interval line on a log x-axis. Below the
// studies, a diamond marks the pooled random-effects estimate. A dashed vertical
// line at 1 marks the null (no effect). All geometry is computed from the numbers
// the meta-analysis engine already produced; nothing here re-estimates anything.

const INK = "#111318";
const ACCENT = "#C4522A";

export interface ForestStudy {
  label: string;
  point: number;
  ciLower: number;
  ciUpper: number;
  weightPct: number; // 0..100, drives the square size
}

export interface ForestPooled {
  label: string;
  point: number;
  ciLower: number;
  ciUpper: number;
}

interface ForestPlotProps {
  measure: string; // "RR" | "HR" | "OR", shown on the axis label
  studies: readonly ForestStudy[];
  pooled: ForestPooled;
  predictionInterval?: { lower: number; upper: number } | null;
}

const ROW_HEIGHT = 34;
const TOP_PAD = 16;
const BOTTOM_AXIS = 56;
const LABEL_WIDTH = 190;
const PLOT_WIDTH = 360;
const RIGHT_PAD = 70; // room for the numeric CI text
const MIN_SQUARE = 5;
const MAX_SQUARE = 18;

function niceLog(value: number): number {
  // Guard against non-positive inputs the log axis can't represent.
  return Math.log(value > 0 ? value : Number.EPSILON);
}

// Choose axis ticks that bracket the data on the log scale. Uses a small fixed
// ladder so ticks land on values a clinician recognizes (0.25, 0.5, 1, 2, ...).
const TICK_LADDER = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10];

function axisBounds(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  const lo = Math.min(min, 1);
  const hi = Math.max(max, 1);
  // Pad by ~15% on the log scale so markers don't touch the plot edges.
  const logLo = niceLog(lo) - 0.15;
  const logHi = niceLog(hi) + 0.15;
  const ticks = TICK_LADDER.filter((t) => niceLog(t) >= logLo && niceLog(t) <= logHi);
  return { lo: Math.exp(logLo), hi: Math.exp(logHi), ticks: ticks.length ? ticks : [1] };
}

export function ForestPlot({ measure, studies, pooled, predictionInterval }: ForestPlotProps) {
  const allLo = Math.min(pooled.ciLower, ...studies.map((s) => s.ciLower));
  const allHi = Math.max(pooled.ciUpper, ...studies.map((s) => s.ciUpper));
  const { lo, hi, ticks } = axisBounds(allLo, allHi);

  const logLo = niceLog(lo);
  const logHi = niceLog(hi);
  const span = logHi - logLo || 1;

  const plotLeft = LABEL_WIDTH;
  const plotRight = LABEL_WIDTH + PLOT_WIDTH;
  const totalWidth = plotRight + RIGHT_PAD;

  const diamondRows = 1;
  const rows = studies.length + diamondRows;
  const height = TOP_PAD + rows * ROW_HEIGHT + BOTTOM_AXIS;

  // Map a ratio value to an x pixel coordinate on the log axis.
  const xOf = (value: number): number =>
    plotLeft + ((niceLog(value) - logLo) / span) * PLOT_WIDTH;

  const maxWeight = Math.max(...studies.map((s) => s.weightPct), 1);
  const squareOf = (weightPct: number): number => {
    const frac = Math.sqrt(Math.max(weightPct, 0) / maxWeight); // area ∝ weight
    return MIN_SQUARE + frac * (MAX_SQUARE - MIN_SQUARE);
  };

  const nullX = xOf(1);
  const axisY = TOP_PAD + rows * ROW_HEIGHT + 8;

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      width="100%"
      role="img"
      aria-label={`Forest plot of ${studies.length} studies pooled to ${measure} ${pooled.point}`}
      className="max-w-full"
    >
      {/* Null line at 1 (no effect). */}
      <line
        x1={nullX}
        y1={TOP_PAD - 4}
        x2={nullX}
        y2={axisY}
        stroke={INK}
        strokeOpacity={0.35}
        strokeDasharray="4 3"
      />

      {/* Study rows. */}
      {studies.map((s, i) => {
        const cy = TOP_PAD + i * ROW_HEIGHT + ROW_HEIGHT / 2;
        const size = squareOf(s.weightPct);
        const cx = xOf(s.point);
        const x1 = xOf(s.ciLower);
        const x2 = xOf(s.ciUpper);
        return (
          <g key={`${s.label}-${i}`}>
            <text
              x={LABEL_WIDTH - 12}
              y={cy + 4}
              textAnchor="end"
              fontSize={12}
              fill={INK}
              fillOpacity={0.8}
            >
              {s.label.length > 26 ? `${s.label.slice(0, 25)}…` : s.label}
            </text>
            <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={INK} strokeOpacity={0.7} strokeWidth={1.5} />
            <rect
              x={cx - size / 2}
              y={cy - size / 2}
              width={size}
              height={size}
              fill={INK}
              fillOpacity={0.85}
            />
            <text x={plotRight + 8} y={cy + 4} fontSize={11} fill={INK} fillOpacity={0.55}>
              {s.point.toFixed(2)} ({s.ciLower.toFixed(2)}–{s.ciUpper.toFixed(2)})
            </text>
          </g>
        );
      })}

      {/* Optional prediction interval, drawn just under the diamond as a thin bar. */}
      {predictionInterval ? (
        <line
          x1={xOf(predictionInterval.lower)}
          y1={TOP_PAD + studies.length * ROW_HEIGHT + ROW_HEIGHT / 2 + 10}
          x2={xOf(predictionInterval.upper)}
          y2={TOP_PAD + studies.length * ROW_HEIGHT + ROW_HEIGHT / 2 + 10}
          stroke={ACCENT}
          strokeOpacity={0.5}
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
      ) : null}

      {/* Pooled random-effects diamond. */}
      {(() => {
        const cy = TOP_PAD + studies.length * ROW_HEIGHT + ROW_HEIGHT / 2;
        const l = xOf(pooled.ciLower);
        const r = xOf(pooled.ciUpper);
        const c = xOf(pooled.point);
        const h = 8;
        return (
          <g>
            <text
              x={LABEL_WIDTH - 12}
              y={cy + 4}
              textAnchor="end"
              fontSize={12}
              fontWeight={600}
              fill={ACCENT}
            >
              {pooled.label}
            </text>
            <polygon
              points={`${l},${cy} ${c},${cy - h} ${r},${cy} ${c},${cy + h}`}
              fill={ACCENT}
              fillOpacity={0.9}
            />
            <text x={plotRight + 8} y={cy + 4} fontSize={11} fontWeight={600} fill={ACCENT}>
              {pooled.point.toFixed(2)} ({pooled.ciLower.toFixed(2)}–{pooled.ciUpper.toFixed(2)})
            </text>
          </g>
        );
      })()}

      {/* Axis. */}
      <line x1={plotLeft} y1={axisY} x2={plotRight} y2={axisY} stroke={INK} strokeOpacity={0.4} />
      {ticks.map((t) => {
        const x = xOf(t);
        return (
          <g key={`tick-${t}`}>
            <line x1={x} y1={axisY} x2={x} y2={axisY + 5} stroke={INK} strokeOpacity={0.4} />
            <text x={x} y={axisY + 18} textAnchor="middle" fontSize={11} fill={INK} fillOpacity={0.6}>
              {t}
            </text>
          </g>
        );
      })}
      <text
        x={(plotLeft + plotRight) / 2}
        y={axisY + 36}
        textAnchor="middle"
        fontSize={11}
        fill={INK}
        fillOpacity={0.5}
      >
        {measure} (log scale) — left of 1 favors treatment
      </text>
    </svg>
  );
}
