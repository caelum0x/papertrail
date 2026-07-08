"use client";

// Lightweight, dependency-free chart + card primitives for the analytics pages.
// Everything renders with Tailwind divs (no chart library): horizontal bars,
// sparkline-style columns, and KPI cards. Kept presentational and pure.

export interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function KpiCard({ label, value, hint }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-ink/40">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink/80">{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink/40">{hint}</div> : null}
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  /** Optional secondary text shown at the row's right edge (e.g. a percentage). */
  suffix?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  emptyMessage?: string;
}

// Horizontal bar chart. Each bar is width-scaled to the max value in the set.
export function BarChart({ data, emptyMessage }: BarChartProps) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  if (data.length === 0 || max === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink/40">
        {emptyMessage ?? "No data yet."}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {data.map((d) => {
        const pct = max > 0 ? Math.round((d.value / max) * 100) : 0;
        return (
          <div key={d.label} className="flex items-center gap-3 text-sm">
            <div className="w-44 shrink-0 truncate text-ink/60" title={d.label}>
              {d.label}
            </div>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-paper">
              <div
                className="h-full rounded bg-accent/70"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-24 shrink-0 text-right tabular-nums text-ink/60">
              {d.value}
              {d.suffix ? (
                <span className="ml-1 text-ink/40">{d.suffix}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface ColumnDatum {
  label: string;
  primary: number;
  /** Optional overlaid value (e.g. distortions within total), drawn darker. */
  secondary?: number;
}

export interface ColumnChartProps {
  data: ColumnDatum[];
  emptyMessage?: string;
}

// Vertical column chart used for time series. Columns scale to the max primary
// value; the optional secondary value is drawn as a darker inset from the bottom.
export function ColumnChart({ data, emptyMessage }: ColumnChartProps) {
  const max = data.reduce((m, d) => Math.max(m, d.primary), 0);
  if (data.length === 0 || max === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink/40">
        {emptyMessage ?? "No activity in this window."}
      </p>
    );
  }
  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto">
      {data.map((d, i) => {
        const primaryPct = Math.max(2, Math.round((d.primary / max) * 100));
        const secondaryPct =
          d.secondary !== undefined
            ? Math.round((d.secondary / max) * 100)
            : 0;
        return (
          <div
            key={`${d.label}-${i}`}
            className="group relative flex h-full min-w-[8px] flex-1 flex-col justify-end"
            title={`${d.label}: ${d.primary}${
              d.secondary !== undefined ? ` (${d.secondary} flagged)` : ""
            }`}
          >
            <div
              className="relative w-full rounded-t bg-accent/40"
              style={{ height: `${primaryPct}%` }}
            >
              {d.secondary !== undefined ? (
                <div
                  className="absolute bottom-0 left-0 w-full rounded-t bg-accent"
                  style={{
                    height: primaryPct > 0 ? `${(secondaryPct / primaryPct) * 100}%` : "0%",
                  }}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function ChartCard({ title, description, children }: SectionProps) {
  return (
    <section className="rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/80">{title}</h2>
      {description ? (
        <p className="mt-1 text-xs text-ink/40">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export interface StateBlockProps {
  kind: "loading" | "error" | "empty";
  message: string;
  onRetry?: () => void;
}

// Uniform loading / error / empty panel used across the analytics pages.
export function StateBlock({ kind, message, onRetry }: StateBlockProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-8 text-center">
      <p className={`text-sm ${kind === "error" ? "text-red-700" : "text-ink/40"}`}>
        {message}
      </p>
      {kind === "error" && onRetry ? (
        <button
          onClick={onRetry}
          className="mt-3 text-sm text-accent hover:underline"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
