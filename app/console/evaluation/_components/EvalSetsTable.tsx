import Link from "next/link";
import { formatTime, formatPercent, type EvalSet } from "../lib";
import { AccuracyBadge } from "./Badges";

// Table of eval sets with case/run counts and last accuracy.

interface EvalSetsTableProps {
  sets: EvalSet[];
}

export function EvalSetsTable({ sets }: EvalSetsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs text-ink/40">
          <th className="px-4 py-2 font-medium">Name</th>
          <th className="px-4 py-2 font-medium">Cases</th>
          <th className="px-4 py-2 font-medium">Runs</th>
          <th className="px-4 py-2 font-medium">Last accuracy</th>
          <th className="px-4 py-2 font-medium">Created</th>
        </tr>
      </thead>
      <tbody>
        {sets.map((s) => (
          <tr key={s.id} className="border-b border-ink/10 last:border-0">
            <td className="px-4 py-2">
              <Link
                href={`/console/evaluation/${s.id}`}
                className="font-medium text-accent hover:underline"
              >
                {s.name}
              </Link>
              {s.description ? (
                <p className="text-xs text-ink/40">{s.description}</p>
              ) : null}
            </td>
            <td className="px-4 py-2 text-ink/60">{s.caseCount ?? 0}</td>
            <td className="px-4 py-2 text-ink/60">{s.runCount ?? 0}</td>
            <td className="px-4 py-2">
              <AccuracyBadge
                value={s.lastAccuracy}
                label={formatPercent(s.lastAccuracy)}
              />
            </td>
            <td className="px-4 py-2 text-xs text-ink/50">
              {formatTime(s.createdAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
