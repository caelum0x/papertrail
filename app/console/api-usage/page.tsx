"use client";

import { useCallback, useEffect, useState } from "react";
import type { UsageSummary } from "@/lib/apiusage/types";
import { fetchSummary } from "./_components/api";
import {
  API_USAGE_TABS,
  ModuleHeader,
  ModuleTabs,
} from "./_components/ModuleHeader";
import { RangePicker } from "./_components/RangePicker";
import { StatCards } from "./_components/StatCards";
import { TopRoutes } from "./_components/TopRoutes";
import { TopKeys } from "./_components/TopKeys";
import { EmptyState, ErrorState, LoadingState } from "./_components/StateBlock";
import { DEFAULT_RANGE_DAYS } from "./_components/shared";

// UsageSummary page: StatCards + TopRoutes + TopKeys over a selectable window.
export default function ApiUsageSummaryPage() {
  const [days, setDays] = useState(DEFAULT_RANGE_DAYS);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchSummary(days);
    if (result.error) {
      setError(result.error);
      setSummary(null);
    } else {
      setSummary(result.data);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <ModuleHeader
        title="API usage"
        description="Traffic, latency, error rate, and rate-limit activity for your organization's API keys."
        actions={
          <RangePicker days={days} onChange={setDays} disabled={loading} />
        }
      />
      <ModuleTabs tabs={API_USAGE_TABS} active="/console/api-usage" />

      {loading ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white">
          <LoadingState label="Loading usage summary…" />
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !summary ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white">
          <EmptyState>No usage data yet.</EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <StatCards summary={summary} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section>
              <h2 className="text-sm font-semibold text-ink/80">Top routes</h2>
              <div className="mt-2 overflow-hidden rounded-lg border border-ink/15 bg-white">
                <TopRoutes routes={summary.topRoutes} />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-ink/80">Top keys</h2>
              <div className="mt-2 overflow-hidden rounded-lg border border-ink/15 bg-white">
                <TopKeys keys={summary.topKeys} />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
