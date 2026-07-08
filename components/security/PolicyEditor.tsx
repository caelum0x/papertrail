"use client";

import { useCallback, useEffect, useState } from "react";
import type { SecurityPolicy, SecurityPolicyKind } from "@/lib/security/types";
import { fetchPolicies, updatePolicy } from "./api";
import { LoadingState, ErrorState, EmptyState } from "./StateViews";
import { PolicyEditorRow } from "./PolicyEditorRow";

// Full editor for the org's security policies: a list of PolicyEditorRow
// components. Owns fetching, per-row save state, and error surfacing. Enable
// toggles persist immediately; config edits persist via each row's Save button.

export function PolicyEditor() {
  const [policies, setPolicies] = useState<SecurityPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKind, setSavingKind] = useState<SecurityPolicyKind | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const persist = useCallback(
    async (
      kind: SecurityPolicyKind,
      patch: { enabled?: boolean; config?: Record<string, unknown> }
    ) => {
      setSavingKind(kind);
      setSaveError(null);
      try {
        const updated = await updatePolicy({ kind, ...patch });
        setPolicies((cur) => cur.map((p) => (p.kind === kind ? updated : p)));
      } catch (err) {
        setSaveError(
          err instanceof Error ? err.message : "Couldn't save the policy."
        );
        // Reload to discard any optimistic drift on failure.
        await load();
      } finally {
        setSavingKind(null);
      }
    },
    [load]
  );

  if (loading) return <LoadingState label="Loading policies…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (policies.length === 0) {
    return (
      <EmptyState
        title="No policies to configure"
        description="Security controls will appear here once available."
      />
    );
  }

  return (
    <div>
      {saveError ? (
        <p className="mb-3 text-sm text-red-600">{saveError}</p>
      ) : null}
      <div className="space-y-3">
        {policies.map((p) => (
          <PolicyEditorRow
            key={p.kind}
            policy={p}
            saving={savingKind === p.kind}
            onToggle={(kind, enabled) => void persist(kind, { enabled })}
            onSaveConfig={(kind, config) => void persist(kind, { config })}
          />
        ))}
      </div>
    </div>
  );
}
