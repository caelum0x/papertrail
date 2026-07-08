"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeatureFlag } from "@/lib/flags/types";
import { fetchFlag } from "@/components/flags/api";
import { FlagHeader } from "@/components/flags/FlagHeader";
import { RolloutControls } from "@/components/flags/RolloutControls";
import { RulesEditor } from "@/components/flags/RulesEditor";
import { FlagAudit } from "@/components/flags/FlagAudit";
import { FlagEvaluator } from "@/components/flags/FlagEvaluator";
import { ErrorState, LoadingState } from "@/components/flags/ui";

// Detail-view orchestrator: fetches one flag and composes the header, rollout
// controls, rules editor, evaluator side panel, and audit history. Each save
// bumps `auditKey` so the history panel refreshes.
export function FlagDetail({ flagId }: { flagId: string }) {
  const [flag, setFlag] = useState<FeatureFlag | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditKey, setAuditKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchFlag(flagId);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load flag.");
      setLoading(false);
      return;
    }
    setFlag(res.data);
    setLoading(false);
  }, [flagId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpdated = useCallback((next: FeatureFlag) => {
    setFlag(next);
    setAuditKey((k) => k + 1);
  }, []);

  if (loading) return <LoadingState label="Loading flag…" />;
  if (error || !flag) {
    return <ErrorState message={error ?? "Flag not found."} onRetry={load} />;
  }

  return (
    <div className="space-y-6">
      <FlagHeader flag={flag} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <RolloutControls flag={flag} onUpdated={onUpdated} />
          <RulesEditor flag={flag} onUpdated={onUpdated} />
        </div>
        <div className="space-y-6">
          <FlagEvaluator flag={flag} />
          <FlagAudit flagId={flag.id} refreshKey={auditKey} />
        </div>
      </div>
    </div>
  );
}
