"use client";

import { useCallback, useState } from "react";
import type { WorkbenchPayload } from "./types";

// Opens the deterministic Summary-of-Findings export for the current inputs. The
// export endpoint is a POST (it needs the study payload), so we submit via fetch,
// turn the returned HTML document into a blob URL, and open it in a new tab — the
// same document a medical writer would paste into a dossier. Baseline risk is not
// part of the export contract, so it is intentionally dropped from the request.

interface ExportButtonProps {
  // Returns the validated payload, or an error string to surface instead of exporting.
  buildPayload: () => { payload: WorkbenchPayload } | { error: string };
}

export function ExportButton({ buildPayload }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExport = useCallback(async () => {
    const built = buildPayload();
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/evidence-report/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: built.payload.claim,
          studies: built.payload.studies,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Export failed.");
      }
      const html = await res.text();
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank", "noopener,noreferrer");
      // Revoke shortly after the new tab has had time to load the document.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export.");
    } finally {
      setBusy(false);
    }
  }, [buildPayload]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void onExport()}
        disabled={busy}
        className="rounded-md border border-ink/20 px-3 py-2 text-sm font-medium text-ink/70 hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {busy ? "Exporting…" : "Export Summary of Findings"}
      </button>
      {error ? (
        <span className="text-xs text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
