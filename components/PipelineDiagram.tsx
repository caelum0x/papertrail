interface PipelineStep {
  label: string;
  detail: string;
}

const STEPS: readonly PipelineStep[] = [
  {
    label: "Retrieve primary source",
    detail: "Semantic search over cached PubMed & ClinicalTrials.gov records.",
  },
  {
    label: "Extract the finding",
    detail: "Structured effect size, population, endpoint, and caveats.",
  },
  {
    label: "Verify & ground every quote",
    detail: "Compare claim vs source and map each span to the raw text.",
  },
];

export function PipelineDiagram() {
  return (
    <ol className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
      {STEPS.map((step, i) => (
        <li key={step.label} className="flex flex-1 items-center gap-4">
          <div className="flex-1 rounded-lg border border-ink/10 bg-white p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-accent">
                {i + 1}
              </span>
              <span className="text-sm font-medium text-ink">
                {step.label}
              </span>
            </div>
            <p className="mt-2 text-sm text-ink/60">{step.detail}</p>
          </div>
          {i < STEPS.length - 1 ? (
            <span
              className="hidden shrink-0 text-lg text-ink/30 sm:inline"
              aria-hidden="true"
            >
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
