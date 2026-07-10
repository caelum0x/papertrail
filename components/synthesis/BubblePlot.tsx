"use client";

// Deterministic meta-regression bubble plot rendered as pure SVG — no chart
// library. Each study is a bubble at (moderator x, effect y); the bubble AREA is
// proportional to its meta-analytic weight (so radius ∝ sqrt(weight)) exactly as
// metafor draws `regplot`. The straight line is the fitted meta-regression
// b0 + b1*x sampled by lib/metaRegression.ts (result.predict → [{x, yFitted}]).
// A rising or falling line means the moderator explains variation in the effect
// across studies. Nothing here re-fits anything; every coordinate is passed in.

const INK = "#111318";
const ACCENT = "#C4522A";

// One study for the bubble plot: moderator value x, effect y, pooling weight.
export interface BubblePoint {
  label: string;
  x: number; // study-level moderator (dose, baseline risk, year, ...)
  y: number; // log effect
  weight: number; // meta-analytic weight (drives bubble area)
}

// One sample of the fitted regression line, matching metaRegression's predict().
export interface FittedPoint {
  x: number;
  yFitted: number;
}

interface BubblePlotProps {
  moderatorLabel: string; // x-axis label (e.g. "Dose (mg)")
  measure: string; // effect label for the y-axis (e.g. "log RR")
  points: readonly BubblePoint[];
  fittedLine: readonly FittedPoint[]; // sorted-by-x samples of b0 + b1*x
}

const TOP_PAD = 18;
const BOTTOM_AXIS = 52;
const LEFT_AXIS = 56;
const RIGHT_PAD = 18;
const PLOT_WIDTH = 380;
const PLOT_HEIGHT = 300;
const MIN_BUBBLE = 4;
const MAX_BUBBLE = 22;

export function BubblePlot({ moderatorLabel, measure, points, fittedLine }: BubblePlotProps) {
  const plotLeft = LEFT_AXIS;
  const plotRight = LEFT_AXIS + PLOT_WIDTH;
  const plotTop = TOP_PAD;
  const plotBottom = TOP_PAD + PLOT_HEIGHT;
  const totalWidth = plotRight + RIGHT_PAD;
  const totalHeight = plotBottom + BOTTOM_AXIS;

  // Domains bracket both the bubbles and the fitted line, padded ~8%.
  const xValues = [
    ...points.map((p) => p.x),
    ...fittedLine.map((f) => f.x),
  ].filter((v) => Number.isFinite(v));
  const yValues = [
    ...points.map((p) => p.y),
    ...fittedLine.map((f) => f.yFitted),
  ].filter((v) => Number.isFinite(v));

  const rawMinX = xValues.length ? Math.min(...xValues) : 0;
  const rawMaxX = xValues.length ? Math.max(...xValues) : 1;
  const rawMinY = yValues.length ? Math.min(...yValues) : 0;
  const rawMaxY = yValues.length ? Math.max(...yValues) : 1;

  const xPad = (rawMaxX - rawMinX || 1) * 0.08;
  const yPad = (rawMaxY - rawMinY || 1) * 0.08;
  const minX = rawMinX - xPad;
  const maxX = rawMaxX + xPad;
  const minY = rawMinY - yPad;
  const maxY = rawMaxY + yPad;
  const xSpan = maxX - minX || 1;
  const ySpan = maxY - minY || 1;

  const xOf = (x: number): number => plotLeft + ((x - minX) / xSpan) * PLOT_WIDTH;
  // y increases upward, so invert the pixel mapping.
  const yOf = (y: number): number => plotBottom - ((y - minY) / ySpan) * PLOT_HEIGHT;

  const maxWeight = Math.max(...points.map((p) => p.weight), Number.EPSILON);
  const radiusOf = (weight: number): number => {
    const frac = Math.sqrt(Math.max(weight, 0) / maxWeight); // area ∝ weight
    return MIN_BUBBLE + frac * (MAX_BUBBLE - MIN_BUBBLE);
  };

  // Fitted line as a polyline (sorted by x for a clean left-to-right stroke).
  const sortedLine = [...fittedLine].sort((a, b) => a.x - b.x);
  const linePoints = sortedLine.map((f) => `${xOf(f.x)},${yOf(f.yFitted)}`).join(" ");

  // Reference line at y = 0 (no effect) when the domain crosses it.
  const nullY = 0 >= minY && 0 <= maxY ? yOf(0) : null;

  const xTickCount = 4;
  const yTickCount = 4;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => minX + (xSpan * i) / xTickCount);
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => minY + (ySpan * i) / yTickCount);

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      width="100%"
      role="img"
      aria-label={`Meta-regression bubble plot of ${points.length} studies: ${measure} versus ${moderatorLabel}, with the fitted regression line`}
      className="max-w-full"
    >
      <title>Meta-regression bubble plot — effect vs moderator, bubble area ∝ weight</title>

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

      {/* Null (no-effect) reference line. */}
      {nullY !== null ? (
        <line
          x1={plotLeft}
          y1={nullY}
          x2={plotRight}
          y2={nullY}
          stroke={INK}
          strokeOpacity={0.3}
          strokeDasharray="4 3"
        />
      ) : null}

      {/* Fitted regression line. */}
      {sortedLine.length >= 2 ? (
        <polyline points={linePoints} fill="none" stroke={ACCENT} strokeOpacity={0.85} strokeWidth={2} />
      ) : null}

      {/* Study bubbles. */}
      {points.map((p, i) => {
        const cx = xOf(p.x);
        const cy = yOf(p.y);
        const r = radiusOf(p.weight);
        return (
          <circle
            key={`${p.label}-${i}`}
            cx={cx}
            cy={cy}
            r={r}
            fill={INK}
            fillOpacity={0.18}
            stroke={INK}
            strokeOpacity={0.55}
          >
            <title>
              {p.label}: {moderatorLabel} {p.x}, effect {p.y.toFixed(3)}, weight {p.weight.toFixed(2)}
            </title>
          </circle>
        );
      })}

      {/* Y-axis (effect). */}
      <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} stroke={INK} strokeOpacity={0.4} />
      {yTicks.map((t, i) => {
        const y = yOf(t);
        return (
          <g key={`y-${i}`}>
            <line x1={plotLeft - 4} y1={y} x2={plotLeft} y2={y} stroke={INK} strokeOpacity={0.4} />
            <text x={plotLeft - 8} y={y + 3} textAnchor="end" fontSize={10} fill={INK} fillOpacity={0.55}>
              {t.toFixed(2)}
            </text>
          </g>
        );
      })}
      <text
        x={16}
        y={(plotTop + plotBottom) / 2}
        textAnchor="middle"
        fontSize={11}
        fill={INK}
        fillOpacity={0.5}
        transform={`rotate(-90 16 ${(plotTop + plotBottom) / 2})`}
      >
        {measure}
      </text>

      {/* X-axis (moderator). */}
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
        {moderatorLabel} — bubble area ∝ study weight
      </text>
    </svg>
  );
}
