"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ControlRun, RunStatus } from "@/lib/complianceOps/types";

// Compliance controls console. Surfaces the OUTCOME of the operationalized
// controls — the last retention purge, the nightly chain-integrity status, and
// the access-review posture — so an operator can see the compliance controls are
// actually running without re-executing them. Admin-only (the API enforces it).

interface ComplianceControlsStatus {
  retentionPurge: ControlRun | null;
  chainIntegrity: ControlRun | null;
  accessReview: ControlRun | null;
  accessReviewSummary: {
    generatedAt: string;
    members: number;
    permissionGrants: number;
    customRoles: number;
    admins: number;
    owners: number;
  };
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function num(detail: Record<string, unknown>, key: string): number {
  const v = detail[key];
  return typeof v === "number" ? v : 0;
}

const STATUS_STYLES: Record<RunStatus, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
};

const STATUS_LABEL: Record<RunStatus, string> = {
  ok: "OK",
  partial: "Partial",
  failed: "Failed",
};

function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function NeverRun() {
  return (
    <span className="rounded border border-ink/10 bg-paper px-1.5 py-0.5 text-xs text-ink/40">
      Not yet run
    </span>
  );
}

export default function ComplianceControlsPage() {
  const [status, setStatus] = useState<ComplianceControlsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/governance/compliance-controls`, {
        headers: { Accept: "application/json" },
      });
      let body: ApiEnvelope<ComplianceControlsStatus> | null = null;
      try {
        body = (await res.json()) as ApiEnvelope<ComplianceControlsStatus>;
      } catch {
        body = null;
      }
      if (!res.ok || !body || !body.success || body.data === null) {
        throw new Error(body?.error ?? "Something went wrong. Please try again.");
      }
      setStatus(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const downloadAccessReview = useCallback(async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/governance/access-review?download=1`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        let message = "Couldn't generate the access-review snapshot.";
        try {
          const body = (await res.json()) as ApiEnvelope<unknown>;
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body; keep default message
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `access-review-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // Refresh so the newly-recorded access-review run appears.
      await load();
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : "Couldn't download the snapshot."
      );
    } finally {
      setDownloading(false);
    }
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            Compliance controls
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            Operational status of the scheduled compliance controls: data-retention
            purge, nightly audit-chain integrity, and periodic access review.
          </p>
        </div>
        <Link
          href="/console/compliance"
          className="rounded-md border border-ink/15 px-3 py-2 text-sm font-medium text-ink/70 hover:border-accent/40"
        >
          Back to compliance
        </Link>
      </div>

      {loading ? (
        <div className="mt-6 bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
          Loading controls…
        </div>
      ) : error ? (
        <div className="mt-6 bg-white border border-red-200 rounded-lg p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : status ? (
        <div className="mt-6 space-y-6">
          {/* Retention purge */}
          <section className="bg-white border border-ink/15 rounded-lg p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink/80">
                  Data-retention purge
                </h2>
                <p className="mt-0.5 text-xs text-ink/40">
                  Rows past their retention window are deleted or anonymized in
                  place. Runs on a schedule; counts only, no content.
                </p>
              </div>
              {status.retentionPurge ? (
                <StatusBadge status={status.retentionPurge.status} />
              ) : (
                <NeverRun />
              )}
            </div>
            {status.retentionPurge ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Last run"
                  value={formatDate(status.retentionPurge.createdAt)}
                />
                <Stat
                  label="Deleted"
                  value={String(num(status.retentionPurge.detail, "deleted"))}
                />
                <Stat
                  label="Anonymized"
                  value={String(num(status.retentionPurge.detail, "anonymized"))}
                />
                <Stat
                  label="Skipped"
                  value={String(num(status.retentionPurge.detail, "skipped"))}
                />
              </dl>
            ) : (
              <p className="mt-4 text-sm text-ink/40">
                No purge has run yet. It executes on the retention-purge schedule.
              </p>
            )}
            {status.retentionPurge?.reason ? (
              <p className="mt-2 text-xs text-amber-700">
                {status.retentionPurge.reason}
              </p>
            ) : null}
          </section>

          {/* Chain integrity */}
          <section className="bg-white border border-ink/15 rounded-lg p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink/80">
                  Audit-chain integrity
                </h2>
                <p className="mt-0.5 text-xs text-ink/40">
                  The WORM audit chain is recomputed nightly. A broken seq/hash
                  raises a high-severity audit event.
                </p>
              </div>
              {status.chainIntegrity ? (
                <StatusBadge status={status.chainIntegrity.status} />
              ) : (
                <NeverRun />
              )}
            </div>
            {status.chainIntegrity ? (
              status.chainIntegrity.status === "ok" ? (
                <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <span aria-hidden>✓</span>
                  <span>
                    Chain intact —{" "}
                    {num(status.chainIntegrity.detail, "length")} entr
                    {num(status.chainIntegrity.detail, "length") === 1
                      ? "y"
                      : "ies"}{" "}
                    verified {formatDate(status.chainIntegrity.createdAt)}.
                  </span>
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <p className="font-medium">Chain integrity failed.</p>
                  <p className="mt-0.5">
                    {status.chainIntegrity.reason ?? "Tampering detected."}
                    {num(status.chainIntegrity.detail, "broken_at_seq") > 0
                      ? ` (seq ${num(status.chainIntegrity.detail, "broken_at_seq")})`
                      : ""}
                  </p>
                  <p className="mt-0.5 text-xs">
                    Checked {formatDate(status.chainIntegrity.createdAt)}.
                  </p>
                </div>
              )
            ) : (
              <p className="mt-4 text-sm text-ink/40">
                No integrity check has run yet. It executes on the chain-integrity
                schedule.
              </p>
            )}
          </section>

          {/* Access review */}
          <section className="bg-white border border-ink/15 rounded-lg p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink/80">Access review</h2>
                <p className="mt-0.5 text-xs text-ink/40">
                  Every role and permission grant in this organization, for a
                  periodic access review. Download a self-describing snapshot.
                </p>
              </div>
              {status.accessReview ? (
                <StatusBadge status={status.accessReview.status} />
              ) : (
                <NeverRun />
              )}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Members" value={String(status.accessReviewSummary.members)} />
              <Stat label="Admins" value={String(status.accessReviewSummary.admins)} />
              <Stat label="Owners" value={String(status.accessReviewSummary.owners)} />
              <Stat
                label="Permission grants"
                value={String(status.accessReviewSummary.permissionGrants)}
              />
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => void downloadAccessReview()}
                disabled={downloading}
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {downloading ? "Preparing…" : "Download snapshot"}
              </button>
              <span className="text-xs text-ink/40">
                {status.accessReview
                  ? `Last review ${formatDate(status.accessReview.createdAt)}`
                  : "No review recorded yet"}
              </span>
            </div>
            {downloadError ? (
              <p className="mt-2 text-sm text-red-600">{downloadError}</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink/40">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink/80">{value}</dd>
    </div>
  );
}
