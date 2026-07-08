import { labelFor, statusClasses, type EvalResult } from "./evalTypes";

interface EvalResultsTableProps {
  rows: EvalResult[];
}

export function EvalResultsTable({ rows }: EvalResultsTableProps) {
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-ink/10 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
            <th className="px-3 py-2 font-medium">Fixture</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Got</th>
            <th className="px-3 py-2 font-medium">Expected</th>
            <th className="px-3 py-2 font-medium">Trust</th>
            <th className="px-3 py-2 font-medium">Grounded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-ink/5 last:border-0">
              <td className="px-3 py-2 font-mono text-xs text-ink/70">{row.id}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${statusClasses(row.status)}`}
                >
                  {row.status}
                  {row.expectedFailure && row.status === "fail" ? "*" : ""}
                </span>
              </td>
              <td className="px-3 py-2 text-ink/70">{labelFor(row.discrepancyType)}</td>
              <td className="px-3 py-2 text-ink/70">
                {labelFor(row.expectedDiscrepancyType)}
              </td>
              <td className="px-3 py-2 text-ink/70">
                {row.trustScore ?? "—"}
              </td>
              <td className="px-3 py-2 text-ink/70">
                {row.groundingOk === undefined
                  ? "—"
                  : row.groundingOk
                    ? "ok"
                    : "BROKEN"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
