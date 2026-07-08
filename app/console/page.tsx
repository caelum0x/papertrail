"use client";

import { useEffect, useState } from "react";

interface OverviewCounts {
  claims: number;
  verifications: number;
  sources: number;
}

const CARDS: { key: keyof OverviewCounts; label: string }[] = [
  { key: "claims", label: "Claims" },
  { key: "verifications", label: "Verifications" },
  { key: "sources", label: "Cached sources" },
];

export default function ConsoleOverviewPage() {
  const [counts, setCounts] = useState<OverviewCounts>({
    claims: 0,
    verifications: 0,
    sources: 0,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stats");
        const body = await res.json().catch(() => null);
        if (cancelled || !body) return;
        // Tolerate both the envelope shape and legacy raw shapes.
        const data = body?.data ?? body ?? {};
        setCounts({
          claims: Number(data.claims ?? data.total_claims ?? 0),
          verifications: Number(
            data.verifications ?? data.total_verifications ?? 0
          ),
          sources: Number(data.sources ?? data.total_sources ?? 0),
        });
      } catch {
        // Leave zeros; Overview is a placeholder dashboard.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink/80">Overview</h1>
      <p className="mt-1 text-sm text-ink/40">
        Workspace summary and recent verification activity.
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {CARDS.map((card) => (
          <div
            key={card.key}
            className="bg-white border border-ink/15 rounded-lg p-5"
          >
            <div className="text-sm text-ink/40">{card.label}</div>
            <div className="mt-2 text-3xl font-semibold text-ink/80">
              {loaded ? counts[card.key] : "—"}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
        <h2 className="text-sm font-medium text-ink/70">Getting started</h2>
        <p className="mt-2 text-sm text-ink/40">
          Use the sidebar to manage projects, submit claims for verification,
          review evidence, and generate reports.
        </p>
      </div>
    </div>
  );
}
