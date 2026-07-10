import { DIMENSION_LABELS, type DimensionAttribution } from "./types";

// The deterministic attribution table: for each of the four design dimensions, whether
// the supporting and refuting sides report DIFFERENT grounded values on it, and the
// rule-scored strength of that difference. The winning (highest-strength, differing)
// dimension is what the reversal is attributed to. Nothing here is LLM-decided.

interface AttributionTableProps {
  attributions: DimensionAttribution[];
  primaryDimension: string | null;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function AttributionTable({ attributions, primaryDimension }: AttributionTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink/15 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink/15 text-xs uppercase tracking-wide text-ink/40">
            <th className="px-4 py-2 font-medium">Dimension</th>
            <th className="px-4 py-2 font-medium">Supporting side</th>
            <th className="px-4 py-2 font-medium">Refuting side</th>
            <th className="px-4 py-2 font-medium">Differs</th>
            <th className="px-4 py-2 font-medium">Strength</th>
          </tr>
        </thead>
        <tbody>
          {attributions.map((a) => {
            const isPrimary = primaryDimension === a.dimension;
            return (
              <tr
                key={a.dimension}
                className={`border-b border-ink/10 last:border-0 ${
                  isPrimary ? "bg-accent/5" : ""
                }`}
              >
                <td className="px-4 py-2">
                  <span className="font-medium text-ink/70">{DIMENSION_LABELS[a.dimension]}</span>
                  {isPrimary ? (
                    <span className="ml-2 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      primary
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-ink/60">
                  {a.supporting_values.length > 0 ? a.supporting_values.join(", ") : "—"}
                </td>
                <td className="px-4 py-2 text-ink/60">
                  {a.refuting_values.length > 0 ? a.refuting_values.join(", ") : "—"}
                </td>
                <td className="px-4 py-2">
                  {a.differs ? (
                    <span className="text-amber-700">yes</span>
                  ) : (
                    <span className="text-ink/30">no</span>
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums text-ink/60">
                  {a.differs ? pct(a.strength) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
