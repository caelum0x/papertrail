"use client";

import { useState } from "react";
import { VerificationView } from "@/components/VerificationView";
import { CompareIntro } from "./_components/CompareIntro";
import { CompareForm } from "./_components/CompareForm";
import { ErrorBanner } from "./_components/ErrorBanner";
import type { VerifyTextResponse } from "./_components/types";

const REQUEST_TIMEOUT_MS = 20000;

export default function ComparePage() {
  const [claim, setClaim] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyTextResponse | null>(null);

  async function handleVerify() {
    setLoading(true);
    setError(null);
    setResult(null);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/verify/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.trim(), source_text: sourceText.trim() }),
        signal: controller.signal,
      });
      const data = (await res.json()) as VerifyTextResponse & { error?: string };
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setResult(data);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  const canSubmit = !loading && claim.trim().length >= 10 && sourceText.trim().length >= 40;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <CompareIntro />

      <CompareForm
        claim={claim}
        onClaimChange={setClaim}
        sourceText={sourceText}
        onSourceTextChange={setSourceText}
        loading={loading}
        canSubmit={canSubmit}
        onVerify={handleVerify}
      />

      {error && <ErrorBanner message={error} />}

      {result?.status === "verified" && (
        <div className="mt-8">
          <VerificationView
            claim={result.claim}
            source={result.source}
            verification={result.verification}
            effectSizeCheck={result.effect_size_check}
            finding={result.finding}
          />
        </div>
      )}
    </main>
  );
}
