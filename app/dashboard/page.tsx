"use client";

import { useEffect, useState } from "react";
import { DashboardHeader } from "./_components/DashboardHeader";
import { StatCards } from "./_components/StatCards";
import { DiscrepancyBreakdown } from "./_components/DiscrepancyBreakdown";
import type { StatsData } from "./_components/dashboardShared";

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/stats")
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) return setError(true);
        const json = (await res.json()) as StatsData;
        setStats(json);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <DashboardHeader />

      {error && <p className="text-sm text-red-800">Couldn&apos;t load stats. Please try again shortly.</p>}
      {!error && stats === null && <p className="text-sm text-ink/50">Loading…</p>}

      {!error && stats && (
        <>
          <StatCards stats={stats} />
          <DiscrepancyBreakdown stats={stats} />
        </>
      )}
    </main>
  );
}
