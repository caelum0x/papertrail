"use client";

import { useCallback, useEffect, useState } from "react";
import type { MetricSeries } from "@/lib/observability/types";
import { fetchMetrics } from "@/components/observability/api";
import { MetricChartCard } from "@/components/observability/MetricChartCard";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/observability/ui";

// Grid of metric cards for a fixed window. Used on the overview page as a
// compact snapshot; the dedicated metrics page adds window controls.

export function MetricsGrid({
  window = "24h",
  buckets = 32,
}: {
  window?: string;
  buckets?: number;
}) {
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchMetrics({ window, buckets });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load metrics.");
      setLoading(false);
      return;
    }
    setSeries(res.data.series);
    setLoading(false);
  }, [window, buckets]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">
          Metrics <span className="text-ink/40">· last {window}</span>
        </h2>
        <button
          onClick={() => void load()}
          className="rounded border border-ink/10 px-2 py-1 text-xs text-ink/60 hover:bg-paper"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <LoadingState label="Loading metrics…" />
      ) : error ? (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : series.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No metrics recorded yet"
            hint="Metrics appear here once the platform starts recording samples."
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => (
            <MetricChartCard key={s.metric} series={s} />
          ))}
        </div>
      )}
    </section>
  );
}
