import type { EvalCase } from "../lib";
import { discrepancyLabel } from "./discrepancy";

// Table of labeled cases in an eval set.

interface CasesTableProps {
  cases: EvalCase[];
}

export function CasesTable({ cases }: CasesTableProps) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-ink/80">Cases</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {cases.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink/40">
            No cases yet. Add one above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink/40">
                <th className="px-4 py-2 font-medium">Claim</th>
                <th className="px-4 py-2 font-medium">Expected</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Substrings</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-ink/10 last:border-0 align-top"
                >
                  <td className="max-w-md px-4 py-2 text-ink/80">{c.claim}</td>
                  <td className="px-4 py-2 text-xs text-ink/60">
                    {discrepancyLabel(c.expectedDiscrepancyType)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink/50">
                    {c.sourceExternalId ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink/50">
                    {c.expectedSubstrings.length > 0
                      ? `${c.expectedSubstrings.length} span(s)`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
