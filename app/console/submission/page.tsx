"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner, ErrorBanner } from "@/components/console/StateBanners";
import { SelectionForm, type SelectionValue } from "./_components/SelectionForm";
import { BundlePreview } from "./_components/BundlePreview";
import type { BundleManifest } from "./_components/types";

// Regulatory submission-bundle console: pick an org evidence report and/or paste
// verification ids, then assemble a CTD/eCTD-style MANIFEST (summary-of-findings,
// methods, evidence table, provenance appendix, honest gaps) and preview it. Assembly
// is deterministic server-side (lib/submission/bundle.ts) — NO LLM, every number and
// span traced to its source. The JSON export downloads the exact manifest previewed.

export default function SubmissionPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [lastSelection, setLastSelection] = useState<SelectionValue | null>(null);
  const [downloading, setDownloading] = useState(false);

  const assemble = useCallback(async (value: SelectionValue) => {
    setLoading(true);
    setError(null);
    setLastSelection(value);
    try {
      const res = await fetch("/api/submission/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationIds: value.verificationIds,
          evidenceReportId: value.evidenceReportId ?? undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | ApiResponse<BundleManifest>
        | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Bundle assembly failed.");
      }
      setManifest(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assemble bundle.");
      setManifest(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Download the exact manifest as a JSON attachment via the route's ?format=json.
  const exportJson = useCallback(async () => {
    if (!lastSelection) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/submission/bundle?format=json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationIds: lastSelection.verificationIds,
          evidenceReportId: lastSelection.evidenceReportId ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | ApiResponse<BundleManifest>
          | null;
        throw new Error(body?.error ?? "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = manifest
        ? `papertrail-submission-bundle-${manifest.bundle_hash.slice(0, 12)}.json`
        : "papertrail-submission-bundle.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export bundle.");
    } finally {
      setDownloading(false);
    }
  }, [lastSelection, manifest]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Regulatory submission bundle"
        subtitle="Compose verified findings, deterministic numbers, grounded spans, and a chain-of-custody trail into an auditable CTD/eCTD-style export. No language model touches the numbers; honest gaps are listed, never fabricated."
        action={
          manifest ? (
            <button
              type="button"
              onClick={() => void exportJson()}
              disabled={downloading}
              className="rounded-md border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink/80 hover:border-accent disabled:opacity-50"
            >
              {downloading ? "Exporting…" : "Export JSON"}
            </button>
          ) : null
        }
      />

      <SelectionForm onAssemble={(v) => void assemble(v)} assembling={loading} />

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <LoadingBanner message="Assembling the submission bundle from verified evidence and provenance…" />
      ) : manifest ? (
        <BundlePreview manifest={manifest} />
      ) : null}
    </div>
  );
}
