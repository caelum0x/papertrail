"use client";

import { useEffect, useState } from "react";
import { StatusHeader } from "./_components/StatusHeader";
import { HealthCard, type HealthResponse } from "./_components/HealthCard";
import { StatusLoading, StatusError } from "./_components/StatusStates";

export default function StatusPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadHealth(): Promise<void> {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as HealthResponse;
        if (active) {
          setHealth(data);
        }
      } catch {
        if (active) {
          setError("Could not reach the health endpoint.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadHealth();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <StatusHeader />

      {loading && <StatusLoading />}

      {!loading && error && <StatusError message={error} />}

      {!loading && !error && health && <HealthCard health={health} />}
    </main>
  );
}
