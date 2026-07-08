import type { ReportResult } from "@/lib/reporting/types";
import { formatDate } from "./format";

interface ResultViewProps {
  result: ReportResult;
}

// Renders a composed report result: metric cards, a status breakdown table, and
// any notes. Shared by the builder PreviewPanel and the run detail view.
export function ResultView({ result }: ResultViewProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink/40">
        Generated {formatDate(result.generatedAt)}
      </p>

      {result.metrics.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {result.metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-lg border border-ink/10 bg-paper p-3"
            >
              <p className="text-xs text-ink/50">{m.label}</p>
              <p className="mt-1 text-2xl font-semibold text-ink/80">
                {m.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {result.breakdown.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-ink/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-paper text-xs uppercase tracking-wide text-ink/40">
                <th className="px-3 py-2 font-medium">Group</th>
                <th className="px-3 py-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {result.breakdown.map((row) => (
                <tr key={row.label} className="border-t border-ink/10">
                  <td className="px-3 py-2 text-ink/70">{row.label}</td>
                  <td className="px-3 py-2 text-ink/70">
                    {row.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result.notes.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-xs text-ink/50">
          {result.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      ) : null}

      {result.metrics.length === 0 &&
      result.breakdown.length === 0 ? (
        <p className="text-sm text-ink/40">No data in this result.</p>
      ) : null}
    </div>
  );
}
