"use client";

import type { MetricSeriesPoint } from "@/lib/observability/types";

// Dependency-free inline SVG sparkline for a metric series. Plots the bucketed
// averages; degrades to a flat baseline when there's nothing to draw.

export function Sparkline({
  points,
  height = 48,
  className = "",
}: {
  points: MetricSeriesPoint[];
  height?: number;
  className?: string;
}) {
  const width = 240;
  if (points.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={`w-full ${className}`}
        preserveAspectRatio="none"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          className="stroke-ink/10"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const values = points.map((p) => p.avg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p.avg - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });

  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${className}`}
      preserveAspectRatio="none"
    >
      <path d={area} className="fill-accent/10" />
      <path
        d={line}
        className="fill-none stroke-accent"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
