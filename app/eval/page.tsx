import rawResults from "@/tests/fixtures/eval-results.json";
import type { EvalResults } from "./_components/evalTypes";
import { EvalHeader } from "./_components/EvalHeader";
import { EmptyState } from "./_components/EmptyState";
import { PopulatedView } from "./_components/PopulatedView";
import { GroundingNote } from "./_components/GroundingNote";

// The /eval page reports PaperTrail's measured accuracy in the open. It renders ONLY
// numbers produced by `npm run eval` against a live DB (scripts/eval.ts overwrites
// tests/fixtures/eval-results.json with real output). Until that runs, the committed
// placeholder has generatedAt: null and an empty results array, and we show an honest
// empty state rather than any invented metric.

const results = rawResults as EvalResults;

export default function EvalPage() {
  const isEmpty = results.results.length === 0 || results.generatedAt === null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <EvalHeader />

      {isEmpty ? <EmptyState /> : <PopulatedView data={results} />}

      <GroundingNote />
    </main>
  );
}
