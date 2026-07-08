"use client";

import { useEffect, useState } from "react";

const STAGES: readonly string[] = [
  "Matching primary source",
  "Extracting the finding",
  "Comparing claim vs source",
  "Grounding every quote",
];

const INTERVAL_MS = 1600;

/**
 * Pure helper: given elapsed milliseconds, returns the 0-based stage index,
 * capped at count - 1. Does not loop or complete on its own.
 */
export function stageForElapsed(
  ms: number,
  count: number,
  intervalMs: number = INTERVAL_MS,
): number {
  if (count <= 0) return 0;
  if (ms <= 0) return 0;
  const index = Math.floor(ms / intervalMs);
  return Math.min(index, count - 1);
}

export function VerifyStepper() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      setCurrent(stageForElapsed(Date.now() - start, STAGES.length));
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <ol className="flex flex-col gap-3" aria-label="Verification progress">
      {STAGES.map((stage, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={stage} className="flex items-center gap-3 text-sm">
            <span
              className={
                done
                  ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs text-white"
                  : active
                    ? "flex h-5 w-5 items-center justify-center rounded-full border border-accent"
                    : "flex h-5 w-5 items-center justify-center rounded-full border border-ink/15"
              }
              aria-hidden="true"
            >
              {done ? (
                "✓"
              ) : active ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              ) : null}
            </span>
            <span
              className={
                done
                  ? "text-ink/70"
                  : active
                    ? "font-medium text-ink"
                    : "text-ink/30"
              }
            >
              {stage}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
