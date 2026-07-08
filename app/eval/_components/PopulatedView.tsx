import { formatPct, type EvalResults } from "./evalTypes";
import { SummaryCard } from "./SummaryCard";
import { EvalResultsTable } from "./EvalResultsTable";

export function PopulatedView({ data }: { data: EvalResults }) {
  const { summary, results: rows, generatedAt } = data;
  const passRate = summary.total > 0 ? summary.passed / summary.total : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Pass rate"
          value={
            passRate === null
              ? "—"
              : `${summary.passed}/${summary.total} (${formatPct(passRate)})`
          }
        />
        <SummaryCard
          label="Discrepancy accuracy"
          value={formatPct(summary.discrepancy_type_accuracy)}
        />
        <SummaryCard
          label="Span-grounding rate"
          value={formatPct(summary.span_grounding_rate)}
        />
        <SummaryCard label="Fixtures" value={String(summary.total)} />
      </div>

      {generatedAt && (
        <p className="mt-3 text-xs text-ink/40">
          Last run: {new Date(generatedAt).toUTCString()}
        </p>
      )}

      <EvalResultsTable rows={rows} />
    </>
  );
}
