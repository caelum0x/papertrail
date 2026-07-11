"use client";

import { useCallback, useState } from "react";
import { ModuleHeader } from "../../claims/_components/ModuleHeader";
import { LoadingBanner } from "@/components/console/StateBanners";
import { assembleExport, downloadExport } from "./_components/api";
import { UpgradeCTA } from "./_components/UpgradeCTA";
import { ExportSummary } from "./_components/ExportSummary";
import type { AuditExportView, UpgradeDetail } from "./_components/types";

// Enterprise immutable audit export console. Choose an optional date range,
// assemble a verifiable export of the org's WORM audit chain, review the
// end-to-end chain-verify status + deterministic export hash, and download the
// signed JSON. Orgs below the Enterprise tier hit the 402 gate and see an
// upgrade CTA instead of an export.

export default function AuditExportPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<
    { detail: UpgradeDetail; message: string } | null
  >(null);
  const [result, setResult] = useState<AuditExportView | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUpgrade(null);
    const res = await assembleExport(from, to);
    if (res.kind === "ok") {
      setResult(res.data);
    } else if (res.kind === "upgrade") {
      setUpgrade({ detail: res.detail, message: res.message });
      setResult(null);
    } else {
      setError(res.message);
      setResult(null);
    }
    setLoading(false);
  }, [from, to]);

  const download = useCallback(async () => {
    setDownloading(true);
    setError(null);
    const res = await downloadExport(from, to);
    if (res.kind === "ok") {
      setResult(res.data);
      setUpgrade(null);
    } else if (res.kind === "upgrade") {
      setUpgrade({ detail: res.detail, message: res.message });
    } else {
      setError(res.message);
    }
    setDownloading(false);
  }, [from, to]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Immutable audit export"
        subtitle="Assemble a deterministic, self-verifying export of your organisation's WORM audit chain — chain-verify status, a reproducible export hash, and an honest list of any integrity gaps."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label
              className="block text-sm font-medium text-ink/70"
              htmlFor="from"
            >
              From (optional)
            </label>
            <input
              id="from"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium text-ink/70"
              htmlFor="to"
            >
              To (optional)
            </label>
            <input
              id="to"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-ink/40">
          Leave both blank to export the full chain. The export hash is
          deterministic and excludes the generation timestamp, so an unchanged
          chain always reproduces the same hash.
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || downloading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Assembling…" : "Assemble export"}
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={loading || downloading}
            className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium text-ink/80 hover:bg-paper disabled:opacity-50"
          >
            {downloading ? "Preparing…" : "Download JSON"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <LoadingBanner message="Verifying the chain and assembling the export…" />
      ) : upgrade ? (
        <UpgradeCTA detail={upgrade.detail} message={upgrade.message} />
      ) : result ? (
        <ExportSummary export={result} />
      ) : null}
    </div>
  );
}
