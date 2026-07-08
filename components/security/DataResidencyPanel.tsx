"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SecurityPolicy } from "@/lib/security/types";
import { fetchPolicies } from "./api";
import { LoadingState, ErrorState } from "./StateViews";

// Read-only side panel summarizing the org's data residency posture. Deep edits
// live in the policy editor; this panel gives access-page context and a link.

const REGION_LABELS: Record<string, string> = {
  us: "United States",
  eu: "European Union",
  apac: "Asia Pacific",
};

export function DataResidencyPanel() {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const policies = await fetchPolicies();
      setPolicy(policies.find((p) => p.kind === "data_residency") ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading data residency…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const region =
    policy && typeof policy.config.region === "string"
      ? policy.config.region
      : null;
  const enabled = policy?.enabled ?? false;

  return (
    <div className="bg-white border border-ink/15 rounded-lg p-5">
      <h3 className="text-sm font-medium text-ink/80">Data residency</h3>
      <p className="mt-1 text-sm text-ink/50">
        Where this organization&apos;s data is stored and processed.
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-ink/50">Status</dt>
          <dd>
            {enabled ? (
              <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                Pinned
              </span>
            ) : (
              <span className="rounded border border-ink/10 bg-paper px-1.5 py-0.5 text-xs text-ink/50">
                Not pinned
              </span>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-ink/50">Region</dt>
          <dd className="text-ink/70">
            {region ? REGION_LABELS[region] ?? region : "—"}
          </dd>
        </div>
      </dl>

      <Link
        href="/console/settings/security-center/policies"
        className="mt-4 inline-block text-sm text-accent hover:underline"
      >
        Change in policy editor
      </Link>
    </div>
  );
}
