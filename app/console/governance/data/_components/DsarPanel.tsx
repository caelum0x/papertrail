"use client";

import { useCallback, useState } from "react";
import type { DsarExport } from "@/lib/governance/dsar";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import { runDsar, downloadDsar } from "./api";

// DSAR panel: enter a data subject's email and assemble the org-scoped package of
// everything PaperTrail holds about them (counts + non-secret records). The result
// can be downloaded as a JSON attachment for the subject's right-of-access request.

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-ink/15 bg-paper p-3 text-center">
      <div className="text-2xl font-semibold text-ink/80">{value}</div>
      <div className="mt-0.5 text-xs text-ink/40">{label}</div>
    </div>
  );
}

export function DsarPanel() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DsarExport | null>(null);

  const onRun = useCallback(async () => {
    if (email.trim().length < 3) {
      setError("Enter the data subject's email.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await runDsar(email.trim());
    if (res.error) {
      setError(res.error);
      setResult(null);
    } else {
      setResult(res.data);
    }
    setLoading(false);
  }, [email]);

  const onDownload = useCallback(async () => {
    if (email.trim().length < 3) {
      setError("Enter the data subject's email.");
      return;
    }
    setDownloading(true);
    setError(null);
    const err = await downloadDsar(email.trim());
    if (err) {
      setError(err);
    }
    setDownloading(false);
  }, [email]);

  return (
    <section className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/70">Data Subject Access Request</h2>
      <p className="mt-1 text-xs text-ink/40">
        Assemble everything this organization holds about a data subject — their
        membership, the audit entries they authored, and the API keys they own.
        Secrets and password hashes are never included, only whether they exist.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label className="block text-xs font-medium text-ink/60" htmlFor="dsar-email">
            Subject email
          </label>
          <input
            id="dsar-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="subject@example.org"
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void onRun()}
          disabled={loading}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Assembling…" : "Run DSAR"}
        </button>
        <button
          type="button"
          onClick={() => void onDownload()}
          disabled={downloading}
          className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium text-ink/70 hover:bg-paper disabled:opacity-50"
        >
          {downloading ? "Preparing…" : "Download JSON"}
        </button>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4">
          <LoadingBanner message="Gathering the subject's data across this organization…" />
        </div>
      ) : result ? (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                result.found
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-ink/5 text-ink/50"
              }`}
            >
              {result.found
                ? "Subject found in this organization"
                : "No data held for this subject"}
            </span>
            <span className="text-xs text-ink/40">
              Assembled {new Date(result.assembledAt).toLocaleString()}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <CountTile label="Memberships" value={result.counts.memberships} />
            <CountTile label="Audit entries" value={result.counts.auditEntries} />
            <CountTile label="API keys" value={result.counts.apiKeys} />
          </div>

          {result.subject ? (
            <div className="rounded-md border border-ink/15 bg-paper p-3 text-sm text-ink/70">
              <div className="font-medium text-ink/80">{result.subject.email}</div>
              {result.subject.name ? (
                <div className="text-xs text-ink/50">{result.subject.name}</div>
              ) : null}
              <div className="mt-1 text-xs text-ink/40">
                Password credential on file:{" "}
                {result.subject.hasPasswordCredential ? "yes" : "no"} · Joined{" "}
                {result.subject.createdAt
                  ? new Date(result.subject.createdAt).toLocaleDateString()
                  : "—"}
              </div>
            </div>
          ) : null}

          {result.auditEntries.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-ink/60">
                Recent audit activity
              </h3>
              <ul className="divide-y divide-ink/10 rounded-md border border-ink/15 text-xs">
                {result.auditEntries.slice(0, 10).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="font-medium text-ink/70">{entry.action}</span>
                    <span className="text-ink/40">{entry.entityType}</span>
                    <span className="text-ink/40">
                      {entry.createdAt
                        ? new Date(entry.createdAt).toLocaleDateString()
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
              {result.auditEntries.length > 10 ? (
                <p className="mt-1 text-xs text-ink/40">
                  Showing 10 of {result.auditEntries.length}. Download the JSON for the
                  full record.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
