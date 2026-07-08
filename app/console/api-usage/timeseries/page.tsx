"use client";

import { useCallback, useEffect, useState } from "react";
import type { UsageTimeseries } from "@/lib/apiusage/types";
import { fetchTimeseries } from "../_components/api";
import {
  API_USAGE_TABS,
  ModuleHeader,
  ModuleTabs,
} from "../_components/ModuleHeader";
import { RangePicker } from "../_components/RangePicker";
import { UsageChart } from "../_components/UsageChart";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../_components/StateBlock";
import { DEFAULT_RANGE_DAYS } from "../_components/shared";

type Bucket = "hour" | "day" | "week";
const BUCKETS: ReadonlyArray<{ label: string; value: Bucket }> = [
  { label: "Hourly", value: "hour" },
  { label: "Daily", value: "day" },
  { label: "Weekly", value: "week" },
];

// UsageChart page: request/error volume over time, bucketed by hour/day/week.
export default function ApiUsageTimeseriesPage() {
  const [days, setDays] = useState(DEFAULT_RANGE_DAYS);
  const [bucket, setBucket] = useState<Bucket>("day");
  const [series, setSeries] = useState<UsageTimeseries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchTimeseries(days, bucket);
    if (result.error) {
      setError(result.error);
      setSeries(null);
    } else {
      setSeries(result.data);
    }
    setLoading(false);
  }, [days, bucket]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <ModuleHeader
        title="API usage"
        description="Request and error volume over time."
        actions={
          <RangePicker days={days} onChange={setDays} disabled={loading} />
        }
      />
      <ModuleTabs tabs={API_USAGE_TABS} active="/console/api-usage/timeseries" />

      <div className="mt-4 inline-flex overflow-hidden rounded-md border border-ink/15 bg-white">
        {BUCKETS.map((b, i) => (
          <button
            key={b.value}
            type="button"
            disabled={loading}
            onClick={() => setBucket(b.value)}
            className={[
              "px-3 py-1.5 text-sm disabled:opacity-40",
              i > 0 ? "border-l border-ink/15" : "",
              b.value === bucket
                ? "bg-accent/10 font-medium text-accent"
                : "text-ink/60 hover:bg-paper",
            ].join(" ")}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <LoadingState label="Loading timeseries…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !series ? (
          <EmptyState>No usage data yet.</EmptyState>
        ) : (
          <UsageChart series={series} />
        )}
      </div>
    </div>
  );
}
