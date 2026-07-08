"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AeSignal } from "@/lib/monitoring/types";
import { AE_STATUSES } from "@/lib/monitoring/types";
import { fetchSignals } from "@/components/monitoring/api";
import {
  SEVERITY_LABELS,
  SEVERITY_STYLES,
  AE_STATUS_LABELS,
} from "@/components/monitoring/labels";
import { StateCard, ErrorCard } from "../_components/StateCard";

const BOARD_LIMIT = 200;

// Signal board sub-page: groups AE signals into status columns for an
// at-a-glance triage view, built from the existing /api/ae-signals endpoint.
export default function SignalBoardPage() {
  const [signals, setSignals] = useState<AeSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSignals({ page: 1, limit: BOARD_LIMIT });
      setSignals(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <Link
        href="/console/signals"
        className="text-xs text-accent hover:underline"
      >
        ← Back to signals
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-ink/80">Signal board</h1>
      <p className="mt-1 text-sm text-ink/40">
        AE signals grouped by triage status. Open the list to change a status.
      </p>

      <div className="mt-6">
        {loading ? (
          <StateCard>Loading board...</StateCard>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => void load()} />
        ) : signals.length === 0 ? (
          <StateCard>
            No signals yet.{" "}
            <Link href="/console/signals" className="text-accent hover:underline">
              Raise one
            </Link>{" "}
            to populate the board.
          </StateCard>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {AE_STATUSES.map((status) => {
              const column = signals.filter((s) => s.status === status);
              return (
                <div
                  key={status}
                  className="rounded-lg border border-ink/10 bg-paper p-3"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                      {AE_STATUS_LABELS[status]}
                    </h2>
                    <span className="text-xs text-ink/40">{column.length}</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {column.length === 0 ? (
                      <li className="text-xs text-ink/30">None</li>
                    ) : (
                      column.map((signal) => (
                        <li
                          key={signal.id}
                          className="rounded-md border border-ink/10 bg-white p-3"
                        >
                          <p className="text-sm font-medium text-ink/80">
                            {signal.drug}
                          </p>
                          <p className="mt-0.5 text-xs text-ink/50 line-clamp-2">
                            {signal.event}
                          </p>
                          <span
                            className={`mt-2 inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[signal.severity]}`}
                          >
                            {SEVERITY_LABELS[signal.severity]}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
