"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, StatCard, Badge, EmptyState, SkeletonText } from "@/components/console/ui";
import { ErrorBanner } from "@/components/console/StateBanners";

// Console landing / workspace overview — the first screen after login. It shows the
// real aggregate verification stats (from /api/stats), the most recent verifications
// (from /api/verifications), and quick-start entry points into the three named-user
// tools. All data is live; loading renders skeletons, and every fetch degrades to an
// error banner or an empty state rather than a blank panel.

interface AggregateStats {
  total_verifications: number;
  total_sources: number;
  avg_trust_score: number | null;
  flagged_rate: number;
}

interface RecentVerification {
  id: string;
  claim_text: string;
  discrepancy_type: string;
  trust_score: number;
  created_at: string;
}

// Map a discrepancy_type onto a human label + badge tone. "accurate" is the only
// clean-verdict case; everything else is a flagged distortion or an honest abstain.
const VERDICT_META: Record<string, { label: string; tone: "success" | "warn" | "danger" | "neutral" }> = {
  accurate: { label: "Accurate", tone: "success" },
  magnitude: { label: "Magnitude", tone: "warn" },
  population: { label: "Population", tone: "warn" },
  caveat: { label: "Dropped caveat", tone: "warn" },
  no_support_found: { label: "No source", tone: "neutral" },
};

function verdictMeta(type: string) {
  return VERDICT_META[type] ?? { label: type.replace(/_/g, " "), tone: "danger" as const };
}

// The three named-user tools this workspace was built around, plus the walkthrough.
const QUICK_ACTIONS: { href: string; title: string; blurb: string }[] = [
  {
    href: "/console/verify",
    title: "Verify a claim",
    blurb: "Trace an efficacy claim to its primary source and flag any distortion.",
  },
  {
    href: "/console/lab-notebook",
    title: "Lab Notebook",
    blurb: "Turn dictated bench notes into a grounded, reproducible experiment record.",
  },
  {
    href: "/console/trial-matcher",
    title: "Trial Matcher",
    blurb: "Match a patient summary against trials with per-criterion reasoning.",
  },
];

function formatTrust(avg: number | null): string {
  return avg === null ? "—" : `${Math.round(avg)}/100`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ConsoleOverviewPage() {
  const [stats, setStats] = useState<AggregateStats | null>(null);
  const [recent, setRecent] = useState<RecentVerification[] | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [recentLoading, setRecentLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/stats");
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body || typeof body.total_verifications !== "number") {
          setError("Couldn't load workspace stats. Showing what's available.");
        } else {
          setStats({
            total_verifications: body.total_verifications,
            total_sources: body.total_sources ?? 0,
            avg_trust_score: body.avg_trust_score ?? null,
            flagged_rate: body.flagged_rate ?? 0,
          });
        }
      } catch {
        if (!cancelled) setError("Couldn't load workspace stats. Showing what's available.");
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();

    (async () => {
      try {
        const res = await fetch("/api/verifications?limit=6");
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        setRecent(Array.isArray(body?.items) ? body.items : []);
      } catch {
        if (!cancelled) setRecent([]);
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink/80">Workspace overview</h1>
        <p className="mt-1 text-sm text-ink/40">
          Live verification activity across your organization.
        </p>
      </header>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Verifications"
          value={stats?.total_verifications ?? 0}
          loading={statsLoading}
        />
        <StatCard
          label="Cached sources"
          value={stats?.total_sources ?? 0}
          hint="PubMed & ClinicalTrials.gov"
          loading={statsLoading}
        />
        <StatCard
          label="Avg trust score"
          value={formatTrust(stats?.avg_trust_score ?? null)}
          loading={statsLoading}
        />
        <StatCard
          label="Flagged rate"
          value={`${Math.round((stats?.flagged_rate ?? 0) * 100)}%`}
          hint="Claims with a discrepancy"
          loading={statsLoading}
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/40">
          Start a task
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.href} href={action.href} className="group">
              <Card className="h-full transition-colors group-hover:border-accent/40">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink/80">
                    {action.title}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-accent opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    &rarr;
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink/50">{action.blurb}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">
            Recent verifications
          </h2>
          <Link href="/console/claims" className="text-sm text-accent hover:underline">
            View all
          </Link>
        </div>

        {recentLoading ? (
          <Card>
            <SkeletonText lines={5} />
          </Card>
        ) : recent && recent.length > 0 ? (
          <Card padded={false}>
            <ul className="divide-y divide-ink/10">
              {recent.map((v) => {
                const meta = verdictMeta(v.discrepancy_type);
                return (
                  <li key={v.id}>
                    <Link
                      href={`/v/${v.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-paper/60"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink/70">
                        {v.claim_text}
                      </span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="w-14 shrink-0 text-right text-sm tabular-nums text-ink/50">
                        {v.trust_score}/100
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs text-ink/35">
                        {formatDate(v.created_at)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <EmptyState
            title="No verifications yet"
            message="Verify your first efficacy claim to see it traced back to its primary source here."
            actionLabel="Verify a claim"
            actionHref="/console/verify"
          />
        )}
      </section>
    </div>
  );
}
