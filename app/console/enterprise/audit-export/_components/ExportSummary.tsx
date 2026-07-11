"use client";

import type { AuditExportView } from "./types";

// Renders the assembled export: end-to-end chain-verify status, the deterministic
// export hash, coverage, and any integrity gaps. All values come from the
// deterministic server assembly — this component only formats them.

interface ExportSummaryProps {
  export: AuditExportView;
}

function formatAt(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

const GAP_LABELS: Record<string, string> = {
  non_contiguous_seq: "Non-contiguous sequence",
  broken_linkage: "Broken hash linkage",
  tampered_event: "Tampered event",
};

export function ExportSummary({ export: doc }: ExportSummaryProps) {
  const verify = doc.chain_verification;
  const cov = doc.coverage;
  const clean = verify.ok && doc.gaps.length === 0;

  return (
    <div className="space-y-6">
      {/* Chain verification status */}
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink/70">
            Chain verification
          </h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              verify.ok
                ? "bg-emerald-50 text-emerald-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {verify.ok ? "Intact end-to-end" : "Integrity break detected"}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink/70">
          {verify.ok
            ? `All ${verify.length} chain entries recompute and link correctly.`
            : verify.reason ??
              `Break at sequence ${verify.brokenAtSeq ?? "unknown"}.`}
        </p>
      </div>

      {/* Export hash */}
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink/70">Export hash</h3>
        <p className="mt-1 text-xs text-ink/40">
          Deterministic sha256 over the canonical export body (excludes the
          generated-at timestamp). Re-exporting an unchanged chain reproduces
          this exact hash.
        </p>
        <code className="mt-2 block break-all rounded-md bg-paper px-3 py-2 font-mono text-xs text-accent">
          {doc.export_hash}
        </code>
        <p className="mt-2 text-xs text-ink/40">
          Generated at {formatAt(doc.generated_at)}
        </p>
      </div>

      {/* Coverage */}
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink/70">Coverage</h3>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/40">
              Exported entries
            </dt>
            <dd className="mt-0.5 font-medium text-ink/80">
              {cov.exported_entries}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/40">
              Total in chain
            </dt>
            <dd className="mt-0.5 font-medium text-ink/80">
              {cov.total_chain_entries}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/40">
              Window
            </dt>
            <dd className="mt-0.5 font-medium text-ink/80">
              {cov.windowed ? "Applied" : "Full chain"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/40">
              Seq range
            </dt>
            <dd className="mt-0.5 font-medium text-ink/80">
              {cov.first_seq === null
                ? "—"
                : `${cov.first_seq} → ${cov.last_seq}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/40">
              Earliest
            </dt>
            <dd className="mt-0.5 font-medium text-ink/80">
              {formatAt(cov.first_at)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/40">
              Latest
            </dt>
            <dd className="mt-0.5 font-medium text-ink/80">
              {formatAt(cov.last_at)}
            </dd>
          </div>
        </dl>
        {cov.windowed ? (
          <p className="mt-3 text-xs text-ink/40">
            {cov.entries_before_window} entr
            {cov.entries_before_window === 1 ? "y" : "ies"} before and{" "}
            {cov.entries_after_window} after the window were excluded from this
            slice.
          </p>
        ) : null}
      </div>

      {/* Integrity gaps */}
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink/70">
            Integrity gaps ({doc.gaps.length})
          </h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              clean
                ? "bg-emerald-50 text-emerald-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {clean ? "No gaps" : "Review needed"}
          </span>
        </div>
        {doc.gaps.length === 0 ? (
          <p className="mt-2 text-sm text-ink/40">
            Every exported entry recomputes and links correctly.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {doc.gaps.map((gap, i) => (
              <li
                key={`${gap.seq}-${gap.kind}-${i}`}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                <span className="font-medium">
                  seq {gap.seq} · {GAP_LABELS[gap.kind] ?? gap.kind}
                </span>
                <span className="mt-0.5 block text-xs text-red-700">
                  {gap.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
