"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { DataExport } from "@/lib/dataexport/types";
import { fetchExport } from "../_components/api";
import { ExportDetail } from "../_components/ExportDetail";
import { DownloadPanel } from "../_components/DownloadPanel";

// Single export detail page: ExportDetail (header + metadata) and DownloadPanel.
// Handles loading / error / not-found states.
export default function ExportDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [item, setItem] = useState<DataExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const result = await fetchExport(id);
    if (result.error) {
      setError(result.error);
      setItem(null);
    } else {
      setItem(result.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-2">
      <Link
        href="/console/data-export"
        className="text-sm text-accent hover:underline"
      >
        ← Data export center
      </Link>

      {loading ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Loading export…
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : !item ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Export not found.
        </div>
      ) : (
        <div className="mt-4">
          <ExportDetail item={item} />
          <DownloadPanel item={item} />
        </div>
      )}
    </div>
  );
}
