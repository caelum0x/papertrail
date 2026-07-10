import { CertaintyBadge } from "../../evidence-report/_components/CertaintyBadge";
import type { EngineFactsView } from "./types";

// The engine-facts panel — every NUMBER in the review, restated from the deterministic
// pipeline (never Claude). Rendering these next to the prose makes the trust boundary
// visible: the badge + figures come from the engine; the surrounding prose is grounded
// against sources. When pooling wasn't possible, we show the honest reason instead.

interface FactsPanelProps {
  facts: EngineFactsView;
}

function fmt(n: number | null, suffix = ""): string {
  return n === null ? "—" : `${n}${suffix}`;
}

export function FactsPanel({ facts }: FactsPanelProps) {
  if (!facts.poolable) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h3 className="text-sm font-semibold text-amber-900">
          Insufficient evidence to pool
        </h3>
        <p className="mt-1 text-sm text-amber-900/80">{facts.engineRationale}</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Engine facts
        </h3>
        {facts.certainty ? <CertaintyBadge certainty={facts.certainty} /> : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink/40">Measure</dt>
          <dd className="font-medium text-ink/80">{facts.measure ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink/40">Studies (k)</dt>
          <dd className="font-medium text-ink/80">{fmt(facts.k)}</dd>
        </div>
        <div>
          <dt className="text-ink/40">Pooled estimate</dt>
          <dd className="font-medium tabular-nums text-ink/80">
            {facts.pooledPoint === null
              ? "—"
              : `${facts.pooledPoint} (${fmt(facts.pooledCiLower)}–${fmt(facts.pooledCiUpper)})`}
          </dd>
        </div>
        <div>
          <dt className="text-ink/40">Reduction</dt>
          <dd className="font-medium tabular-nums text-ink/80">
            {fmt(facts.pooledReductionPercent, "%")}
          </dd>
        </div>
        <div>
          <dt className="text-ink/40">Heterogeneity I²</dt>
          <dd className="font-medium tabular-nums text-ink/80">{fmt(facts.iSquared, "%")}</dd>
        </div>
        <div>
          <dt className="text-ink/40">Claim vs pool</dt>
          <dd className="font-medium text-ink/80">
            {facts.verdict ? facts.verdict.replace(/_/g, " ") : "—"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 border-t border-ink/10 pt-2 text-xs text-ink/50">
        {facts.engineRationale}
      </p>
    </section>
  );
}
