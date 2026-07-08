"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Signature, SignatureMeaning } from "@/lib/compliance/types";
import { SIGNATURE_MEANINGS } from "@/lib/compliance/types";
import { fetchSignatures, createSignature } from "../api";

const PAGE_SIZE = 20;

const MEANING_LABELS: Record<SignatureMeaning, string> = {
  approval: "Approval",
  review: "Review",
  authorship: "Authorship",
  responsibility: "Responsibility",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function shortHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export default function SignaturesPage() {
  const [items, setItems] = useState<Signature[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [meaning, setMeaning] = useState<SignatureMeaning>("approval");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSignatures({ page, limit: PAGE_SIZE });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setFormError(null);
      try {
        await createSignature({
          entityType: entityType.trim(),
          entityId: entityId.trim(),
          meaning,
        });
        setEntityType("");
        setEntityId("");
        setMeaning("approval");
        setShowForm(false);
        setPage(1);
        await load();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Couldn't record the signature."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [entityType, entityId, meaning, load]
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-ink/40">
            <Link href="/console/compliance" className="hover:underline">
              Compliance
            </Link>{" "}
            / E-signatures
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink/80">
            E-signatures
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            Electronic signatures binding a signer and a declared meaning to a
            specific record, anchored to the tamper-evident audit chain.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setFormError(null);
          }}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {showForm ? "Cancel" : "Sign a record"}
        </button>
      </div>

      {showForm ? (
        <form
          onSubmit={onSubmit}
          className="mt-6 bg-white border border-ink/15 rounded-lg p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-ink/60">Entity type</span>
              <input
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                required
                className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
                placeholder="e.g. verification"
              />
            </label>
            <label className="block">
              <span className="text-sm text-ink/60">Meaning</span>
              <select
                value={meaning}
                onChange={(e) =>
                  setMeaning(e.target.value as SignatureMeaning)
                }
                className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
              >
                {SIGNATURE_MEANINGS.map((m) => (
                  <option key={m} value={m}>
                    {MEANING_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-sm text-ink/60">Entity ID (uuid)</span>
            <input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              required
              className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>

          {formError ? (
            <p className="text-sm text-red-600">{formError}</p>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={
                submitting ||
                entityType.trim().length === 0 ||
                entityId.trim().length === 0
              }
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Signing…" : "Sign"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <div className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
            Loading signatures…
          </div>
        ) : error ? (
          <div className="bg-white border border-red-200 rounded-lg p-6 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
            No signatures yet. Sign a record to create the first one.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((sig) => (
              <li
                key={sig.id}
                className="bg-white border border-ink/15 rounded-lg p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-ink/80">
                      <span className="rounded border border-ink/10 bg-paper px-1.5 py-0.5 text-xs text-ink/60">
                        {MEANING_LABELS[sig.meaning]}
                      </span>
                      <span className="truncate">
                        {sig.entity_type}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-ink/40 truncate">
                      {sig.entity_id}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/40">
                      <span>
                        {sig.signer_name ?? sig.signer_email ?? sig.signer_id}
                      </span>
                      <span>·</span>
                      <span className="font-mono" title={sig.signed_hash}>
                        {shortHash(sig.signed_hash)}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-ink/40">
                    {formatDate(sig.signed_at)}
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
            {total} signature{total === 1 ? "" : "s"}
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
    </div>
  );
}
