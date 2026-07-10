import type { DeepResearchEvidence } from "./types";

// Stage 2 — the deterministic evidence layer. For each sub-question, shows the
// pooled engine result (or an honest "insufficient" note) plus the sources that
// contributed. Every number here comes from the pipeline, not from Claude.

interface EvidencePanelProps {
  evidence: DeepResearchEvidence[];
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—";
}

function EvidenceCard({ item }: { item: DeepResearchEvidence }) {
  const { sub_question, result } = item;
  const report = result.report;

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-sm font-medium text-ink/80">{sub_question.question}</p>

      {report.ok ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">
              {report.pooled.k} {report.pooled.measure} pooled
            </span>
            <span className="rounded-full border border-ink/15 px-2 py-0.5 text-ink/60">
              {fmt(report.pooled.random.point)} (95% CI {fmt(report.pooled.random.ciLower)}–
              {fmt(report.pooled.random.ciUpper)})
            </span>
            <span className="rounded-full border border-ink/15 px-2 py-0.5 text-ink/60">
              I² {fmt(report.pooled.heterogeneity.iSquared)}%
            </span>
            <span className="rounded-full border border-ink/15 px-2 py-0.5 capitalize text-ink/60">
              GRADE {report.certainty.certainty}
            </span>
            <span className="rounded-full border border-ink/15 px-2 py-0.5 capitalize text-ink/60">
              {report.verdict.verdict.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-ink/55">{report.rationale}</p>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-amber-300/40 bg-amber-50/50 p-2 text-xs text-amber-800">
          Insufficient evidence: {report.reason}
        </p>
      )}

      {result.usedSources.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {result.usedSources.map((s) => (
            <li
              key={s.id}
              className="rounded border border-ink/10 bg-white px-2 py-0.5 text-[10px] text-ink/50"
            >
              {s.title ?? `${s.source_type} ${s.id}`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function EvidencePanel({ evidence }: EvidencePanelProps) {
  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
        Per-sub-question evidence
      </h2>
      <p className="mt-1 text-xs text-ink/40">
        Deterministic pooled effects from the evidence pipeline — every number below is
        engine-computed, not model-generated.
      </p>
      <div className="mt-4 space-y-3">
        {evidence.map((item, i) => (
          <EvidenceCard key={i} item={item} />
        ))}
      </div>
    </section>
  );
}
