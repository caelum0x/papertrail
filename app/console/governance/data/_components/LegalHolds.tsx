"use client";

import { useCallback, useEffect, useState } from "react";
import type { LegalHold } from "@/lib/governance/legalHold";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import { fetchLegalHolds, placeHold, releaseHold } from "./api";

// Legal-hold panel: place a preservation hold on a data subject (blocks retention
// purge for that subject) and release existing holds. Admin-only server-side; the
// UI simply surfaces the org's holds and the place/release actions.

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function LegalHolds() {
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  const [subject, setSubject] = useState("");
  const [reason, setReason] = useState("");
  const [placing, setPlacing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchLegalHolds(activeOnly);
    if (res.error) {
      setError(res.error);
      setHolds([]);
    } else {
      setHolds(res.data ?? []);
    }
    setLoading(false);
  }, [activeOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPlace = useCallback(async () => {
    if (subject.trim().length < 1) {
      setError("Enter a subject (usually an email) to place a hold.");
      return;
    }
    setPlacing(true);
    setError(null);
    const res = await placeHold({
      subject: subject.trim(),
      reason: reason.trim() ? reason.trim() : undefined,
    });
    if (res.error) {
      setError(res.error);
    } else {
      setSubject("");
      setReason("");
      await load();
    }
    setPlacing(false);
  }, [subject, reason, load]);

  const onRelease = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      const res = await releaseHold(id);
      if (res.error) {
        setError(res.error);
      } else {
        await load();
      }
      setBusyId(null);
    },
    [load]
  );

  return (
    <section className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink/70">Legal holds</h2>
          <p className="mt-1 text-xs text-ink/40">
            Preserve a data subject against retention purge during litigation or a
            regulatory obligation. An active hold blocks all automated deletion for
            that subject.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink/60">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Active only
        </label>
      </div>

      {/* Place a hold */}
      <div className="mt-4 grid gap-3 rounded-md border border-ink/15 bg-paper p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="block text-xs font-medium text-ink/60" htmlFor="hold-subject">
            Subject
          </label>
          <input
            id="hold-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="subject@example.org"
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/60" htmlFor="hold-reason">
            Reason (optional)
          </label>
          <input
            id="hold-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Matter #2026-014 preservation"
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void onPlace()}
          disabled={placing}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {placing ? "Placing…" : "Place hold"}
        </button>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      {/* Holds list */}
      <div className="mt-4">
        {loading ? (
          <LoadingBanner message="Loading legal holds…" />
        ) : holds.length === 0 ? (
          <div className="rounded-md border border-ink/15 bg-paper p-6 text-center text-sm text-ink/40">
            No legal holds{activeOnly ? " are currently active" : " have been placed"}.
          </div>
        ) : (
          <ul className="divide-y divide-ink/10 rounded-md border border-ink/15">
            {holds.map((hold) => (
              <li key={hold.id} className="flex items-center justify-between gap-4 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink/80">
                      {hold.subject}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        hold.active
                          ? "bg-amber-50 text-amber-800"
                          : "bg-ink/5 text-ink/50"
                      }`}
                    >
                      {hold.active ? "Active" : "Released"}
                    </span>
                  </div>
                  {hold.reason ? (
                    <p className="mt-0.5 truncate text-xs text-ink/50">{hold.reason}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-ink/40">
                    Placed {formatDate(hold.placedAt)}
                    {hold.releasedAt ? ` · Released ${formatDate(hold.releasedAt)}` : ""}
                  </p>
                </div>
                {hold.active ? (
                  <button
                    type="button"
                    onClick={() => void onRelease(hold.id)}
                    disabled={busyId === hold.id}
                    className="shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-paper disabled:opacity-50"
                  >
                    {busyId === hold.id ? "Releasing…" : "Release"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
