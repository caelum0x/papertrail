"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchRegistryAnalytics,
  type RegistryAnalytics,
} from "../client";
import { StateBlock } from "../components";
import { RegistryMetrics } from "../_components/RegistryMetrics";

export default function EvidenceAnalyticsPage() {
  const [data, setData] = useState<RegistryAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchRegistryAnalytics();
    if (result.error) {
      setError(result.error);
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div>
        <Link href="/console/analytics" className="text-xs text-accent hover:underline">
          ← Analytics
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink/80">Evidence & registry</h1>
        <p className="mt-1 text-sm text-ink/40">
          How the org&apos;s verifications compare against registered
          ClinicalTrials.gov results — the ground truth a generic checker can&apos;t
          reach.
        </p>
      </div>

      <div className="mt-6">
        {loading ? (
          <StateBlock kind="loading" message="Loading registry analytics…" />
        ) : error ? (
          <StateBlock kind="error" message={error} onRetry={load} />
        ) : !data || data.trialMatchedVerifications === 0 ? (
          <StateBlock
            kind="empty"
            message="No verifications matched to a ClinicalTrials.gov source yet."
          />
        ) : (
          <RegistryMetrics data={data} />
        )}
      </div>
    </div>
  );
}
