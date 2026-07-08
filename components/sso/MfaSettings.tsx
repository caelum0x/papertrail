"use client";

import { useCallback, useEffect, useState } from "react";
import type { MfaFactor } from "@/lib/sso/types";
import { fetchFactors, deleteFactor } from "@/components/sso/api";
import { MfaFactorRow } from "@/components/sso/MfaFactorRow";
import { MfaEnrollDialog } from "@/components/sso/MfaEnrollDialog";
import { EmptyState } from "@/components/sso/EmptyState";

// Multi-factor authentication settings for the current user. Lists their factors
// and drives the enroll dialog. Composes MfaFactorRow + MfaEnrollDialog +
// EmptyState. Self-contained loading / error / empty states.

export function MfaSettings() {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFactors(await fetchFactors());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MFA factors.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onEnrolled = useCallback((factor: MfaFactor) => {
    setFactors((prev) => {
      const rest = prev.filter((f) => f.id !== factor.id);
      return [factor, ...rest];
    });
    setShowDialog(false);
  }, []);

  const onDelete = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await deleteFactor(id);
      setFactors((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove factor.");
    } finally {
      setBusyId(null);
    }
  }, []);

  const hasVerified = factors.some((f) => f.verified);

  return (
    <section className="bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-ink/70">
            Two-factor authentication
          </h2>
          <p className="text-xs text-ink/40">
            {hasVerified
              ? "2FA is active on your account."
              : "Add an authenticator app to protect your account."}
          </p>
        </div>
        <button
          onClick={() => setShowDialog(true)}
          className="text-sm border border-ink/15 rounded px-3 py-1.5 hover:border-accent shrink-0"
        >
          Add authenticator
        </button>
      </div>

      {error ? <p className="px-5 py-2 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="p-5 text-sm text-ink/40">Loading factors…</p>
      ) : factors.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="No authenticators yet"
            message="Set up an authenticator app to require a second factor at sign-in."
          />
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {factors.map((f) => (
            <MfaFactorRow
              key={f.id}
              factor={f}
              busy={busyId === f.id}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      {showDialog ? (
        <MfaEnrollDialog
          onClose={() => setShowDialog(false)}
          onEnrolled={onEnrolled}
        />
      ) : null}
    </section>
  );
}
