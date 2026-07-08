"use client";

import { useState } from "react";
import type { DataExport } from "@/lib/dataexport/types";
import { downloadExport } from "./api";
import { extensionForFormat } from "./download-utils";

interface DownloadPanelProps {
  item: DataExport;
}

// Download control for an export's detail page. Streams the document from the
// download route and triggers a browser download; surfaces success / error state.
export function DownloadPanel({ item }: DownloadPanelProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ready = item.status === "complete";

  const onDownload = async () => {
    setDownloading(true);
    setError(null);
    setDone(false);
    const fallback =
      item.params?.filename ??
      `papertrail-${item.scope}.${extensionForFormat(item.format)}`;
    const result = await downloadExport(item.id, fallback);
    setDownloading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone(true);
  };

  return (
    <div className="mt-6 rounded-lg border border-ink/15 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink/80">Download</h2>
      <p className="mt-1 text-sm text-ink/50">
        The file is generated on demand from your live, org-scoped data, so it
        always reflects the latest records.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onDownload}
          disabled={!ready || downloading}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {downloading
            ? "Preparing…"
            : `Download ${item.format.toUpperCase()}`}
        </button>
        {!ready ? (
          <span className="text-xs text-ink/40">
            Available once the export is complete.
          </span>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {done && !error ? (
        <p className="mt-3 text-sm text-emerald-700">Download started.</p>
      ) : null}
    </div>
  );
}
