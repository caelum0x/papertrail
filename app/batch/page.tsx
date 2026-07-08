"use client";

import { useMemo, useState } from "react";
import { BatchResults, BatchResultItem } from "@/components/BatchResults";
import { DownloadBatchReport } from "@/components/DownloadBatchReport";
import { splitIntoClaims } from "@/lib/claimSplitter";
import { BatchHeader } from "./_components/BatchHeader";
import { BatchInput } from "./_components/BatchInput";
import {
  BatchLoading,
  BatchError,
  TruncatedNotice,
  BatchEmpty,
} from "./_components/BatchStates";

// Must mirror MAX_BATCH in app/api/verify/batch/route.ts. Only the first MAX_BATCH
// detected claims are ever verified; the rest are reported as truncated.
const MAX_BATCH = 5;
const REQUEST_TIMEOUT_MS = 60000;

interface BatchResponse {
  results?: BatchResultItem[];
  truncated?: boolean;
  total_detected?: number;
  error?: string;
}

export default function BatchPage() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResultItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [totalDetected, setTotalDetected] = useState(0);

  // Live client-side count so the user sees how many claims will be checked as they type.
  const detected = useMemo(() => splitIntoClaims(text), [text]);
  const detectedCount = detected.length;

  async function handleVerify() {
    if (detectedCount === 0) {
      setError("No claims detected yet. Paste a sentence or paragraph to verify.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    setTruncated(false);
    setTotalDetected(0);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/verify/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const data: BatchResponse = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setResults(data.results ?? []);
      setTruncated(Boolean(data.truncated));
      setTotalDetected(data.total_detected ?? (data.results?.length ?? 0));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <BatchHeader maxBatch={MAX_BATCH} />

      <BatchInput
        text={text}
        onTextChange={setText}
        loading={loading}
        detectedCount={detectedCount}
        maxBatch={MAX_BATCH}
        onVerify={handleVerify}
      />

      {loading && <BatchLoading count={Math.min(detectedCount, MAX_BATCH)} />}

      {error && <BatchError message={error} />}

      {results && (
        <div className="mt-8">
          {truncated && <TruncatedNotice totalDetected={totalDetected} maxBatch={MAX_BATCH} />}
          {results.length === 0 ? (
            <BatchEmpty />
          ) : (
            <>
              <div className="mb-4 flex justify-end">
                <DownloadBatchReport items={results} />
              </div>
              <BatchResults results={results} />
            </>
          )}
        </div>
      )}
    </main>
  );
}
