"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { VerificationView, VerificationViewData } from "@/components/VerificationView";

type LoadState = "loading" | "ok" | "notfound" | "error";

interface PermalinkPayload extends VerificationViewData {
  verification_id: string;
  created_at?: string;
}

export default function PermalinkPage({ params }: { params: { id: string } }) {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<PermalinkPayload | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/verifications/${params.id}`)
      .then(async (res) => {
        if (!active) return;
        if (res.status === 404) return setState("notfound");
        if (!res.ok) return setState("error");
        const json = await res.json();
        // The API returns effect_size_check (snake_case); map to the view's prop.
        setData({ ...json, effectSizeCheck: json.effect_size_check ?? undefined });
        setState("ok");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [params.id]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <Link href="/" className="text-2xl font-semibold hover:underline">
            PaperTrail
          </Link>
          <p className="mt-1 text-sm text-ink/60">Shared verification record</p>
        </div>
        <Link href="/" className="text-sm text-accent hover:underline">
          Check a claim →
        </Link>
      </header>

      {state === "loading" && <p className="text-sm text-ink/50">Loading verification…</p>}

      {state === "notfound" && (
        <div className="rounded-lg border border-ink/15 bg-white p-4 text-sm text-ink/70">
          This verification wasn&apos;t found. It may have been created on a different deployment.
        </div>
      )}

      {state === "error" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Couldn&apos;t load this verification. Please try again.
        </div>
      )}

      {state === "ok" && data && (
        <VerificationView
          claim={data.claim}
          source={data.source}
          verification={data.verification}
          effectSizeCheck={data.effectSizeCheck}
        />
      )}
    </main>
  );
}
