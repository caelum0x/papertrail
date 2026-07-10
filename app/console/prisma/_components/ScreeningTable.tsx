import type { ScreenedRecordSummary } from "@/lib/prisma/schemas";

// The AI screening worklist: every candidate record with Claude's relevance score,
// include/exclude decision, and the rationale — plus the grounding trust badge showing
// whether that rationale was verified against the record's own abstract.

function DecisionBadge({ decision }: { decision: ScreenedRecordSummary["decision"] }) {
  const cls =
    decision === "included"
      ? "bg-emerald-100 text-emerald-800"
      : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${cls}`}>
      {decision}
    </span>
  );
}

export function ScreeningTable({ records }: { records: ScreenedRecordSummary[] }) {
  if (records.length === 0) return null;

  // Most-likely-relevant first — the active-learning triage ordering.
  const sorted = [...records].sort((a, b) => b.relevance - a.relevance);

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
        AI screening ({records.length} records)
      </h2>
      <ul className="mt-3 divide-y divide-ink/10">
        {sorted.map((r) => (
          <li key={r.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-ink/80">{r.title}</p>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs tabular-nums text-ink/50">
                  {(r.relevance * 100).toFixed(0)}%
                </span>
                <DecisionBadge decision={r.decision} />
              </div>
            </div>
            <p className="mt-1 text-sm text-ink/60">{r.rationale}</p>
            <p className="mt-1 text-xs text-ink/40">
              {r.groundingOk
                ? "✓ rationale grounded in the record's abstract"
                : "⚠ rationale not grounded to the abstract — treat with caution"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
