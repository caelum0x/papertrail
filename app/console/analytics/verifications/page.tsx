"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchVerificationAnalytics,
  type VerificationAnalytics,
} from "../client";
import { StateBlock } from "../components";
import { RangeSelect } from "../_components/RangeSelect";
import { VerificationCharts } from "../_components/VerificationCharts";

const RANGE_OPTIONS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

export default function VerificationAnalyticsPage() {
  const [rangeDays, setRangeDays] = useState(30);
  const [data, setData] = useState<VerificationAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchVerificationAnalytics(rangeDays);
    if (result.error) {
      setError(result.error);
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [rangeDays]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/console/analytics"
            className="text-xs text-accent hover:underline"
          >
            ← Analytics
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-ink/80">
            Verification trends
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            Verification volume, distortion flags, and trust distribution over time.
          </p>
        </div>
        <RangeSelect
          options={RANGE_OPTIONS}
          value={rangeDays}
          onChange={setRangeDays}
        />
      </div>

      <div className="mt-6">
        {loading ? (
          <StateBlock kind="loading" message="Loading verification trends…" />
        ) : error ? (
          <StateBlock kind="error" message={error} onRetry={load} />
        ) : !data || data.totalInRange === 0 ? (
          <StateBlock
            kind="empty"
            message="No verifications in this window. Try a wider range."
          />
        ) : (
          <VerificationCharts data={data} />
        )}
      </div>
    </div>
  );
}
