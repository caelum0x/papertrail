// Per-check verdict card for the bioinformatics-finding console. Presentational
// only — renders one deterministic check's kind, verdict badge, summary, and the
// named source it came from. House tokens only.

import { type FindingCheck, checkVerdictClass, humanize } from "./types";

export function VerdictCard({ check }: { check: FindingCheck }) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{humanize(check.kind)}</p>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${checkVerdictClass(
            check.verdict
          )}`}
        >
          {humanize(check.verdict)}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink/70">{check.summary}</p>
      <p className="mt-2 text-xs text-ink/40">Source: {check.source}</p>
    </div>
  );
}
