import type { GroundedAlertAssessment } from "@/lib/alerts/schemas";

// Renders the candidate source text with the grounded evidence quote highlighted in
// place, using the char offsets the trust layer produced. Because the offsets come from
// lib/grounding.ts (a real substring of the source text), the highlight is guaranteed to
// line up — no fuzzy re-search in the browser. The relevance/impact reasons are shown
// beneath as the model's justification for the assessment.

interface GroundedEvidenceProps {
  sourceText: string;
  assessment: GroundedAlertAssessment;
}

const RELEVANCE_LABEL: Record<GroundedAlertAssessment["relevant"], string> = {
  relevant: "Relevant to the watched topic",
  not_relevant: "Not relevant to the watched topic",
};

export function GroundedEvidence({ sourceText, assessment }: GroundedEvidenceProps) {
  const { start, end, status } = assessment.grounding;
  const before = sourceText.slice(0, start);
  const highlight = sourceText.slice(start, end);
  const after = sourceText.slice(end);

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
          Supporting evidence (grounded to the source text)
        </p>
        <span className="font-mono text-[10px] text-ink/30">
          chars {start}–{end} · {status}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">
        {before}
        <mark className="rounded bg-accent/20 px-0.5 text-ink/90">{highlight}</mark>
        {after}
      </p>

      <div className="mt-4 grid gap-3 border-t border-ink/10 pt-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
            Relevance
          </p>
          <p className="mt-1 text-sm font-medium text-ink/80">
            {RELEVANCE_LABEL[assessment.relevant]}
          </p>
          <p className="mt-1 text-sm text-ink/60">{assessment.relevance_reason}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
            Why this impact
          </p>
          <p className="mt-1 text-sm text-ink/60">{assessment.impact_reason}</p>
        </div>
      </div>
    </div>
  );
}
