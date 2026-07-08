"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SecurityPolicy, SecurityPolicyKind } from "@/lib/security/types";
import { fetchPolicies, updatePolicy } from "./api";
import { LoadingState, ErrorState, EmptyState } from "./StateViews";
import { PolicyCard } from "./PolicyCard";

// Grid of security-control cards for the overview page. Fetches the org's
// policies, renders each as a PolicyCard, and persists enable/disable toggles
// optimistically (rolling back on failure).

export function PolicyCards() {
  const [policies, setPolicies] = useState<SecurityPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKind, setSavingKind] = useState<SecurityPolicyKind | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPolicies();
      setPolicies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = useCallback(
    async (kind: SecurityPolicyKind, next: boolean) => {
      setSavingKind(kind);
      setToggleError(null);
      const prev = policies;
      setPolicies((cur) =>
        cur.map((p) => (p.kind === kind ? { ...p, enabled: next } : p))
      );
      try {
        const updated = await updatePolicy({ kind, enabled: next });
        setPolicies((cur) =>
          cur.map((p) => (p.kind === kind ? updated : p))
        );
      } catch (err) {
        setPolicies(prev);
        setToggleError(
          err instanceof Error ? err.message : "Couldn't update the policy."
        );
      } finally {
        setSavingKind(null);
      }
    },
    [policies]
  );

  if (loading) return <LoadingState label="Loading security controls…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (policies.length === 0) {
    return (
      <EmptyState
        title="No security controls available"
        description="Security controls will appear here once configured."
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">Security controls</h2>
        <Link
          href="/console/settings/security-center/policies"
          className="text-sm text-accent hover:underline"
        >
          Manage in editor
        </Link>
      </div>
      {toggleError ? (
        <p className="mt-2 text-sm text-red-600">{toggleError}</p>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-3">
        {policies.map((p) => (
          <PolicyCard
            key={p.kind}
            policy={p}
            saving={savingKind === p.kind}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
