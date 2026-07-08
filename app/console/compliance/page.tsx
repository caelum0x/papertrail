"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  AuditChainEntry,
  ChainVerification,
  RetentionPolicy,
} from "@/lib/compliance/types";
import {
  fetchChainEntries,
  verifyChain,
  fetchRetentionPolicies,
  upsertRetentionPolicy,
} from "./api";

const PAGE_SIZE = 20;

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function shortHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function describeEvent(event: Record<string, unknown>): string {
  const kind = typeof event.kind === "string" ? event.kind : "event";
  if (kind === "signature") {
    const meaning = typeof event.meaning === "string" ? event.meaning : "signed";
    const entityType =
      typeof event.entity_type === "string" ? event.entity_type : "entity";
    return `Signature (${meaning}) on ${entityType}`;
  }
  return kind;
}

export default function CompliancePage() {
  const [entries, setEntries] = useState<AuditChainEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError, setPoliciesError] = useState<string | null>(null);

  const [entityType, setEntityType] = useState("");
  const [retainDays, setRetainDays] = useState("365");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyFormError, setPolicyFormError] = useState<string | null>(null);

  const loadChain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchChainEntries({ page, limit: PAGE_SIZE });
      setEntries(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    setPoliciesError(null);
    try {
      const res = await fetchRetentionPolicies();
      setPolicies(res);
    } catch (err) {
      setPoliciesError(
        err instanceof Error ? err.message : "Something went wrong."
      );
      setPolicies([]);
    } finally {
      setPoliciesLoading(false);
    }
  }, []);

  const runVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await verifyChain();
      setVerification(res);
    } catch (err) {
      setVerifyError(
        err instanceof Error ? err.message : "Couldn't verify the chain."
      );
      setVerification(null);
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    void loadChain();
  }, [loadChain]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  useEffect(() => {
    void runVerify();
  }, [runVerify]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  const onSavePolicy = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSavingPolicy(true);
      setPolicyFormError(null);
      try {
        const days = Number(retainDays);
        if (!Number.isInteger(days) || days < 0) {
          throw new Error("Retention days must be a non-negative integer.");
        }
        await upsertRetentionPolicy({
          entityType: entityType.trim(),
          retainDays: days,
        });
        setEntityType("");
        setRetainDays("365");
        await loadPolicies();
      } catch (err) {
        setPolicyFormError(
          err instanceof Error ? err.message : "Couldn't save the policy."
        );
      } finally {
        setSavingPolicy(false);
      }
    },
    [entityType, retainDays, loadPolicies]
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Compliance</h1>
          <p className="mt-1 text-sm text-ink/40">
            Tamper-evident audit chain, e-signatures, and data-retention policies
            for 21 CFR Part 11-style controls.
          </p>
        </div>
        <Link
          href="/console/compliance/signatures"
          className="rounded-md border border-ink/15 px-3 py-2 text-sm font-medium text-ink/70 hover:border-accent/40"
        >
          E-signatures
        </Link>
      </div>

      {/* Chain integrity */}
      <section className="mt-6">
        <div className="bg-white border border-ink/15 rounded-lg p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink/80">
                Audit chain integrity
              </h2>
              <p className="mt-0.5 text-xs text-ink/40">
                Every entry is hash-chained to the one before it. Any tampering
                breaks the chain.
              </p>
            </div>
            <button
              onClick={() => void runVerify()}
              disabled={verifying}
              className="rounded-md border border-ink/15 px-2.5 py-1.5 text-xs font-medium text-ink/70 hover:border-accent/40 disabled:opacity-50"
            >
              {verifying ? "Verifying…" : "Re-verify"}
            </button>
          </div>

          <div className="mt-4">
            {verifyError ? (
              <p className="text-sm text-red-600">{verifyError}</p>
            ) : verification ? (
              verification.ok ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <span aria-hidden>✓</span>
                  <span>
                    Chain intact — {verification.length} entr
                    {verification.length === 1 ? "y" : "ies"} verified.
                  </span>
                </div>
              ) : (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <p className="font-medium">Chain integrity failed.</p>
                  <p className="mt-0.5">
                    {verification.reason ?? "Unknown tampering detected."}
                    {verification.brokenAtSeq !== null
                      ? ` (seq ${verification.brokenAtSeq})`
                      : ""}
                  </p>
                </div>
              )
            ) : verifying ? (
              <p className="text-sm text-ink/40">Verifying chain…</p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Retention policies */}
      <section className="mt-6">
        <div className="bg-white border border-ink/15 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-ink/80">
            Data-retention policies
          </h2>
          <p className="mt-0.5 text-xs text-ink/40">
            How long records of each entity type must be retained before they may
            be purged.
          </p>

          <form
            onSubmit={onSavePolicy}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <label className="block">
              <span className="text-xs text-ink/60">Entity type</span>
              <input
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                required
                className="mt-1 w-48 rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
                placeholder="e.g. claim"
              />
            </label>
            <label className="block">
              <span className="text-xs text-ink/60">Retain (days)</span>
              <input
                type="number"
                min={0}
                value={retainDays}
                onChange={(e) => setRetainDays(e.target.value)}
                required
                className="mt-1 w-32 rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={savingPolicy || entityType.trim().length === 0}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {savingPolicy ? "Saving…" : "Save policy"}
            </button>
          </form>
          {policyFormError ? (
            <p className="mt-2 text-sm text-red-600">{policyFormError}</p>
          ) : null}

          <div className="mt-5">
            {policiesLoading ? (
              <p className="text-sm text-ink/40">Loading policies…</p>
            ) : policiesError ? (
              <div className="text-center">
                <p className="text-sm text-red-600">{policiesError}</p>
                <button
                  onClick={() => void loadPolicies()}
                  className="mt-2 text-sm text-accent hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : policies.length === 0 ? (
              <p className="text-sm text-ink/40">
                No retention policies yet. Add one above.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink/40">
                    <th className="py-2 font-medium">Entity type</th>
                    <th className="py-2 font-medium">Retain (days)</th>
                    <th className="py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id} className="border-b border-ink/5">
                      <td className="py-2 text-ink/80">{p.entity_type}</td>
                      <td className="py-2 text-ink/60">{p.retain_days}</td>
                      <td className="py-2 text-ink/40">
                        {formatDate(p.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* Chain entries */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink/80">Audit chain entries</h2>
        <div className="mt-3">
          {loading ? (
            <div className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
              Loading chain…
            </div>
          ) : error ? (
            <div className="bg-white border border-red-200 rounded-lg p-6 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button
                onClick={() => void loadChain()}
                className="mt-3 text-sm text-accent hover:underline"
              >
                Try again
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
              No chain entries yet. Signing an entity appends the first entry.
            </div>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="bg-white border border-ink/15 rounded-lg p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-ink/80">
                        <span className="rounded border border-ink/10 bg-paper px-1.5 py-0.5 text-xs text-ink/60">
                          #{entry.seq}
                        </span>
                        <span className="truncate">
                          {describeEvent(entry.event)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink/40">
                        <span title={entry.entry_hash}>
                          hash {shortHash(entry.entry_hash)}
                        </span>
                        <span title={entry.prev_hash}>
                          prev {shortHash(entry.prev_hash)}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-ink/40">
                      {formatDate(entry.created_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!loading && !error && total > PAGE_SIZE ? (
          <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
            <span>
              {total} entr{total === 1 ? "y" : "ies"}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="text-accent disabled:text-ink/30"
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="text-accent disabled:text-ink/30"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
