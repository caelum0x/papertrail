import type { EvalResultRecord } from "../lib";
import { discrepancyLabel } from "./discrepancy";
import { PassFailBadge, Check } from "./Badges";

// Per-case results table for a run.

interface ResultsTableProps {
  results: EvalResultRecord[];
}

export function ResultsTable({ results }: ResultsTableProps) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-ink/80">Per-case results</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {results.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink/40">
            This run has no per-case results.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink/40">
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Claim</th>
                <th className="px-4 py-2 font-medium">Expected</th>
                <th className="px-4 py-2 font-medium">Predicted</th>
                <th className="px-4 py-2 font-medium">Trust</th>
                <th className="px-4 py-2 font-medium">Checks</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const score = r.predicted.score;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-ink/10 last:border-0 align-top"
                  >
                    <td className="px-4 py-2">
                      <PassFailBadge passed={r.passed} />
                    </td>
                    <td className="max-w-xs px-4 py-2 text-ink/80">
                      {r.case?.claim ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink/60">
                      {discrepancyLabel(
                        r.case?.expectedDiscrepancyType ?? null
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink/60">
                      {r.predicted.error ? (
                        <span className="text-red-700" title={r.predicted.error}>
                          error
                        </span>
                      ) : (
                        discrepancyLabel(r.predicted.discrepancyType)
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink/60">
                      {r.predicted.trustScore ?? "—"}
                      {r.predicted.trustBand ? (
                        <span className="text-ink/40">
                          {" "}
                          ({r.predicted.trustBand})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {score ? (
                        <div className="flex flex-wrap gap-1">
                          <Check ok={score.discrepancyMatch} label="type" />
                          <Check ok={score.trustBandMatch} label="band" />
                          {score.spanGroundingApplicable ? (
                            <Check ok={score.spanGrounded} label="spans" />
                          ) : (
                            <span className="rounded border border-ink/15 bg-paper px-1.5 py-0.5 text-ink/40">
                              spans n/a
                            </span>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
