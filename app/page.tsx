"use client";

import { useState } from "react";
import { ClaimInput } from "@/components/ClaimInput";
import { VerificationView } from "@/components/VerificationView";
import { VerifyStepper } from "@/components/VerifyStepper";
import { Hero } from "@/components/Hero";
import { PipelineDiagram } from "@/components/PipelineDiagram";
import { LocalHistory } from "@/components/LocalHistory";
import { addLocalHistory } from "@/lib/localHistory";
import { fetchVerify, type VerifyResponse } from "./_components/verifyClient";
import { SourceHintInput } from "./_components/SourceHintInput";
import { ExampleClaims } from "./_components/ExampleClaims";
import { PermalinkButton } from "./_components/PermalinkButton";
import { HomeError, NoSupportMessage } from "./_components/HomeMessages";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [claim, setClaim] = useState("");
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sourceHint, setSourceHint] = useState("");

  async function handleSubmit(submitted: string, hintOverride?: string) {
    const hint = hintOverride !== undefined ? hintOverride : sourceHint;
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    setClaim(submitted);
    addLocalHistory(submitted);
    try {
      let attempt: { ok: boolean; data: VerifyResponse & { error?: string } };
      try {
        attempt = await fetchVerify(submitted, hint);
      } catch {
        // Network error or timeout (e.g. Vercel cold-start) — retry exactly once.
        // We do NOT retry HTTP error responses (4xx/5xx) to avoid double-spending.
        attempt = await fetchVerify(submitted, hint);
      }
      if (!attempt.ok) {
        setError(attempt.data.error || "Something went wrong. Please try again.");
        return;
      }
      setResult(attempt.data);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyPermalink(id: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/v/${id}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const verified = result?.status === "verified" && result.source && result.verification;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      {!result && !loading && (
        <div className="mb-8">
          <Hero />
        </div>
      )}

      <div className="max-w-2xl">
        <ClaimInput onSubmit={handleSubmit} loading={loading} />

        <SourceHintInput value={sourceHint} onChange={setSourceHint} disabled={loading} />

        <ExampleClaims loading={loading} onSelect={(c) => handleSubmit(c, "")} />

        {!result && !loading && (
          <div className="mt-4">
            <LocalHistory onSelect={(c) => handleSubmit(c, "")} />
          </div>
        )}
      </div>

      {loading && (
        <div className="mt-6 max-w-2xl">
          <VerifyStepper />
        </div>
      )}

      {!result && !loading && (
        <div className="mt-10">
          <PipelineDiagram />
        </div>
      )}

      {error && <HomeError message={error} />}

      {result?.status === "no_support_found" && <NoSupportMessage message={result.message} />}

      {verified && result.verification && (
        <div className="mt-8">
          {result.verification_id && (
            <PermalinkButton
              copied={copied}
              onCopy={() => copyPermalink(result.verification_id as string)}
            />
          )}
          <VerificationView
            claim={claim}
            source={result.source ?? null}
            verification={result.verification}
            effectSizeCheck={result.effect_size_check}
            finding={result.finding}
            crossSourceAgreement={result.cross_source_agreement}
            corroboratingSources={result.corroborating_sources}
            registryCheck={result.registry_check}
          />
        </div>
      )}
    </main>
  );
}
