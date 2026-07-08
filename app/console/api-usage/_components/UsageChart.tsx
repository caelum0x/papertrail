import type { UsageTimeseries } from "@/lib/apiusage/types";
import { EmptyState } from "./StateBlock";
import { formatNumber } from "./shared";

// Dependency-free stacked bar chart of requests (with the error portion tinted)
// per time bucket. Rendered as inline SVG so the module ships no charting lib.
export function UsageChart({ series }: { series: UsageTimeseries }) {
  const points = series.points;
  if (points.length === 0) {
    return <EmptyState>No requests recorded in this window.</EmptyState>;
  }

  const width = 720;
  const height = 220;
  const padX = 8;
  const padY = 16;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const max = Math.max(...points.map((p) => p.requests), 1);
  const slot = innerW / points.length;
  const barW = Math.max(1, Math.min(slot * 0.7, 40));

  return (
    <div className="w-full overflow-x-auto p-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Requests per ${series.bucket} over ${series.rangeDays} days`}
      >
        {/* baseline */}
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="currentColor"
          className="text-ink/10"
        />
        {points.map((p, i) => {
          const h = (p.requests / max) * innerH;
          const errH = p.requests > 0 ? (p.errors / p.requests) * h : 0;
          const x = padX + i * slot + (slot - barW) / 2;
          const yTop = height - padY - h;
          return (
            <g key={p.bucket}>
              <rect
                x={x}
                y={yTop}
                width={barW}
                height={h}
                rx={2}
                className="fill-accent/50"
              >
                <title>
                  {p.bucket}: {p.requests} req, {p.errors} err
                </title>
              </rect>
              {errH > 0 ? (
                <rect
                  x={x}
                  y={height - padY - errH}
                  width={barW}
                  height={errH}
                  rx={2}
                  className="fill-red-400/80"
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex items-center justify-between text-xs text-ink/40">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-accent/50" />
            Requests
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-red-400/80" />
            Errors
          </span>
        </span>
        <span>
          {formatNumber(series.totalRequests)} requests · peak {formatNumber(max)}/
          {series.bucket}
        </span>
      </div>
    </div>
  );
}
