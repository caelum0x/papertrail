"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { scienceGet } from "@/lib/science/apiClient";
import type { SessionDetail } from "@/lib/science/clientTypes";

interface Citation {
  title: string;
  source: string;
  note?: string | null;
}

// Rolls up every artifact the assistant produced across the whole session so a
// researcher can review queries, sources, and next steps in one place. Uses the
// existing session-detail endpoint only.
function collectArtifacts(detail: SessionDetail) {
  const queries: string[] = [];
  const citations: Citation[] = [];
  const nextSteps: string[] = [];
  for (const m of detail.messages) {
    if (m.role !== "assistant") continue;
    queries.push(...m.artifacts.literatureQueries);
    citations.push(...m.artifacts.citations);
    nextSteps.push(...m.artifacts.nextSteps);
  }
  return { queries, citations, nextSteps };
}

export default function SessionArtifactsPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    const res = await scienceGet<SessionDetail>(
      `/api/science/sessions/${sessionId}`
    );
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load session.");
      return;
    }
    setDetail(res.data);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const artifacts = detail ? collectArtifacts(detail) : null;
  const isEmpty =
    artifacts &&
    artifacts.queries.length === 0 &&
    artifacts.citations.length === 0 &&
    artifacts.nextSteps.length === 0;

  return (
    <div className="max-w-3xl">
      <Link
        href={sessionId ? `/console/science/${sessionId}` : "/console/science"}
        className="text-sm text-accent hover:underline"
      >
        &larr; Back to session
      </Link>

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading artifacts...</p>
      ) : error ? (
        <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm text-accent">
            Retry
          </button>
        </div>
      ) : detail && artifacts ? (
        <div className="mt-4">
          <h1 className="text-2xl font-semibold text-ink/80">
            Artifacts · {detail.session.title}
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            Every literature query, suggested source, and next step surfaced in
            this session.
          </p>

          {isEmpty ? (
            <div className="mt-6 bg-white border border-ink/15 rounded-lg p-8 text-center">
              <p className="text-sm text-ink/60">No artifacts yet.</p>
              <p className="mt-1 text-sm text-ink/40">
                Ask the assistant for PubMed queries or source suggestions to
                populate this view.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {artifacts.queries.length > 0 ? (
                <section className="bg-white border border-ink/15 rounded-lg p-5">
                  <h2 className="text-sm font-medium text-ink/70">
                    Literature queries ({artifacts.queries.length})
                  </h2>
                  <ul className="mt-3 space-y-1">
                    {artifacts.queries.map((q, i) => (
                      <li key={i} className="text-sm text-ink/70">
                        <code className="rounded bg-paper px-1 py-0.5 text-xs">
                          {q}
                        </code>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {artifacts.citations.length > 0 ? (
                <section className="bg-white border border-ink/15 rounded-lg p-5">
                  <h2 className="text-sm font-medium text-ink/70">
                    Suggested sources ({artifacts.citations.length})
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {artifacts.citations.map((c, i) => (
                      <li key={i} className="text-sm text-ink/70">
                        <span className="font-medium">{c.title}</span>{" "}
                        <span className="text-ink/40">— {c.source}</span>
                        {c.note ? (
                          <span className="block text-xs text-ink/40">
                            {c.note}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {artifacts.nextSteps.length > 0 ? (
                <section className="bg-white border border-ink/15 rounded-lg p-5">
                  <h2 className="text-sm font-medium text-ink/70">
                    Next steps ({artifacts.nextSteps.length})
                  </h2>
                  <ul className="mt-3 list-disc pl-5 space-y-1">
                    {artifacts.nextSteps.map((s, i) => (
                      <li key={i} className="text-sm text-ink/70">
                        {s}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
