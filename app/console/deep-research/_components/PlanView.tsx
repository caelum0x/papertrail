import type { DeepResearchPlan } from "./types";

// Stage 1 — the research plan. Shows Claude's interpretation of the question and
// the 3-6 focused sub-questions it decomposed it into (each with a rationale).

interface PlanViewProps {
  plan: DeepResearchPlan;
  supported: number;
}

export function PlanView({ plan, supported }: PlanViewProps) {
  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
          Research plan
        </h2>
        <span className="text-[11px] text-ink/35">
          {supported} / {plan.sub_questions.length} sub-questions with pooled evidence
        </span>
      </div>
      <p className="mt-2 text-sm text-ink/70">{plan.interpretation}</p>
      <ol className="mt-4 space-y-3">
        {plan.sub_questions.map((sq, i) => (
          <li key={i} className="rounded-lg border border-ink/10 bg-white p-3">
            <p className="text-sm font-medium text-ink/80">
              {i + 1}. {sq.question}
            </p>
            <p className="mt-1 text-xs text-ink/45">{sq.rationale}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
