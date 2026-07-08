"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface SourceDetail {
  id: string;
  source_type: string;
  external_id: string;
  title: string | null;
  url: string;
  raw_text: string;
}

interface VerificationSummary {
  id: string;
  claim_text: string;
  discrepancy_type: string;
  trust_score: number;
  created_at: string;
}

interface DetailResponse {
  source: SourceDetail;
  verifications: VerificationSummary[];
}

const DISCREPANCY_LABELS: Record<string, string> = {
  accurate: "Accurate",
  magnitude_overstated: "Magnitude overstated",
  population_overgeneralized: "Population overgeneralized",
  caveat_dropped: "Caveat dropped",
  no_support_found: "No support found",
};

interface SourceBadge {
  label: string;
  classes: string;
}

function badgeFor(sourceType: string): SourceBadge {
  if (sourceType === "pubmed") {
    return { label: "PubMed", classes: "bg-blue-100 text-blue-800" };
  }
  if (sourceType === "clinicaltrials") {
    return { label: "ClinicalTrials.gov", classes: "bg-purple-100 text-purple-800" };
  }
  return { label: sourceType, classes: "bg-ink/10 text-ink/70" };
}

function identifierLabel(sourceType: string, externalId: string): string {
  if (sourceType === "pubmed") return `PMID ${externalId}`;
  return externalId;
}

function trustBadgeColor(score: number): string {
  if (score >= 90) return "bg-green-100 text-green-800 border-green-300";
  if (score >= 60) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-red-100 text-red-800 border-red-300";
}

export default function SourceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound" | "error">(
    "loading"
  );

  useEffect(() => {
    if (!id) return;
    let active = true;
    setStatus("loading");
    fetch(`/api/sources/${id}`)
      .then(async (res) => {
        if (!active) return;
        if (res.status === 404) return setStatus("notfound");
        if (!res.ok) return setStatus("error");
        const json = (await res.json()) as DetailResponse;
        setData(json);
        setStatus("ok");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 flex items-baseline justify-between">
        <Link href="/" className="text-2xl font-semibold hover:underline">
          PaperTrail
        </Link>
        <Link href="/sources" className="text-sm text-accent hover:underline">
          ← All sources
        </Link>
      </header>

      {status === "loading" && <p className="text-sm text-ink/50">Loading…</p>}

      {status === "notfound" && (
        <p className="text-sm text-ink/70">
          That source isn&apos;t in the cache.{" "}
          <Link href="/sources" className="text-accent hover:underline">
            Browse cached sources
          </Link>
          .
        </p>
      )}

      {status === "error" && (
        <p className="text-sm text-red-800">Couldn&apos;t load this source.</p>
      )}

      {status === "ok" && data && (
        <>
          <section className="mb-8">
            <div className="mb-2 flex items-center gap-3">
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                  badgeFor(data.source.source_type).classes
                }`}
              >
                {badgeFor(data.source.source_type).label}
              </span>
              <span className="text-xs text-ink/50">
                {identifierLabel(data.source.source_type, data.source.external_id)}
              </span>
            </div>
            <h1 className="text-xl font-semibold text-ink/90">
              <a
                href={data.source.url}
                target="_blank"
                rel="noreferrer"
                className="hover:text-accent hover:underline"
              >
                {data.source.title ?? "Untitled source"}
              </a>
            </h1>
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink/40">
              Source text
            </h2>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-ink/10 bg-white p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink/80">
                {data.source.raw_text}
              </pre>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink/40">
              Claims checked against this source
            </h2>
            {data.verifications.length === 0 ? (
              <p className="text-sm text-ink/50">
                No claims have been checked against this source yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.verifications.map((v) => (
                  <li key={v.id}>
                    <Link
                      href={`/v/${v.id}`}
                      className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white p-3 hover:border-accent/40"
                    >
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${trustBadgeColor(
                          v.trust_score
                        )}`}
                      >
                        {v.trust_score}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink/80">
                        {v.claim_text}
                      </span>
                      <span className="shrink-0 text-xs text-ink/50">
                        {DISCREPANCY_LABELS[v.discrepancy_type] ?? v.discrepancy_type}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
