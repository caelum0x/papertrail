import type { WorkflowDefinition } from "@/lib/workflows/types";

// Numbered ordered list of a workflow's steps, used on the detail page.

interface WorkflowStepsProps {
  steps: WorkflowDefinition["steps"];
}

export function WorkflowSteps({ steps }: WorkflowStepsProps) {
  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-wide text-ink/40">Steps</div>
      <ol className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <li
            key={`${s.name}-${i}`}
            className="flex gap-3 rounded-md border border-ink/10 bg-paper p-3"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-medium text-ink/60">
              {i + 1}
            </span>
            <div>
              <div className="text-sm font-medium text-ink/80">
                {s.name}
                <span className="ml-2 text-xs font-normal text-ink/40">
                  {s.kind}
                </span>
              </div>
              <p className="text-sm text-ink/60">{s.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
