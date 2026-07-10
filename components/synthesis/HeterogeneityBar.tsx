"use client";

// Deterministic I² heterogeneity gauge rendered as pure SVG — no chart library.
// I² (from lib/metaAnalysis.ts, a 0..100 percentage) measures the share of the
// total variability across studies attributable to between-study heterogeneity
// rather than chance. The Cochrane thresholds at 25 / 50 / 75 split the bar into
// four shaded bands — low / moderate / substantial / considerable — and a marker
// pins the observed value. Nothing here computes I²; it only visualizes the
// number the meta-analysis engine already produced.

const INK = "#111318";
const ACCENT = "#C4522A";

interface HeterogeneityBarProps {
  iSquared: number; // 0..100
}

// Cochrane rough guide (Higgins 2003). Each band gets a progressively darker
// wash so "considerable" reads as the most concerning without needing color.
interface Band {
  from: number;
  to: number;
  label: string;
  opacity: number;
}

const BANDS: readonly Band[] = [
  { from: 0, to: 25, label: "low", opacity: 0.08 },
  { from: 25, to: 50, label: "moderate", opacity: 0.16 },
  { from: 50, to: 75, label: "substantial", opacity: 0.26 },
  { from: 75, to: 100, label: "considerable", opacity: 0.38 },
];

const WIDTH = 320;
const BAR_X = 8;
const BAR_Y = 26;
const BAR_WIDTH = WIDTH - BAR_X * 2;
const BAR_HEIGHT = 20;
const HEIGHT = 84;

function bandFor(value: number): Band {
  // Highest band whose lower bound the value has reached (75 → considerable).
  return (
    [...BANDS].reverse().find((b) => value >= b.from) ?? BANDS[0]
  );
}

export function HeterogeneityBar({ iSquared }: HeterogeneityBarProps) {
  // Clamp defensively — the engine reports 0..100, but never trust the boundary.
  const value = Math.min(100, Math.max(0, Number.isFinite(iSquared) ? iSquared : 0));
  const xOf = (pct: number): number => BAR_X + (pct / 100) * BAR_WIDTH;
  const markerX = xOf(value);
  const band = bandFor(value);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      role="img"
      aria-label={`Heterogeneity I-squared is ${value.toFixed(0)} percent (${band.label})`}
      className="max-w-full"
    >
      <title>Heterogeneity (I²) — {value.toFixed(0)}% ({band.label})</title>

      {/* Heading. */}
      <text x={BAR_X} y={16} fontSize={12} fontWeight={600} fill={INK} fillOpacity={0.85}>
        Heterogeneity (I²)
      </text>
      <text x={WIDTH - BAR_X} y={16} textAnchor="end" fontSize={12} fontWeight={600} fill={ACCENT}>
        {value.toFixed(0)}% · {band.label}
      </text>

      {/* Band segments. */}
      {BANDS.map((b) => {
        const x = xOf(b.from);
        const w = xOf(b.to) - x;
        return (
          <rect
            key={b.label}
            x={x}
            y={BAR_Y}
            width={w}
            height={BAR_HEIGHT}
            fill={INK}
            fillOpacity={b.opacity}
          />
        );
      })}

      {/* Bar outline. */}
      <rect
        x={BAR_X}
        y={BAR_Y}
        width={BAR_WIDTH}
        height={BAR_HEIGHT}
        fill="none"
        stroke={INK}
        strokeOpacity={0.2}
      />

      {/* Threshold ticks at 25 / 50 / 75. */}
      {[25, 50, 75].map((t) => {
        const x = xOf(t);
        return (
          <g key={`thr-${t}`}>
            <line x1={x} y1={BAR_Y} x2={x} y2={BAR_Y + BAR_HEIGHT} stroke={INK} strokeOpacity={0.3} />
            <text x={x} y={BAR_Y + BAR_HEIGHT + 12} textAnchor="middle" fontSize={9} fill={INK} fillOpacity={0.5}>
              {t}
            </text>
          </g>
        );
      })}

      {/* Value marker. */}
      <line x1={markerX} y1={BAR_Y - 4} x2={markerX} y2={BAR_Y + BAR_HEIGHT + 4} stroke={ACCENT} strokeWidth={2} />
      <polygon
        points={`${markerX - 4},${BAR_Y - 4} ${markerX + 4},${BAR_Y - 4} ${markerX},${BAR_Y + 2}`}
        fill={ACCENT}
      />
    </svg>
  );
}
