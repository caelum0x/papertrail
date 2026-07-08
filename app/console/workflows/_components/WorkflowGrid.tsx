import type { WorkflowDefinition } from "@/lib/workflows/types";
import type { CustomWorkflow } from "@/lib/workflows/repository";
import { WorkflowCard } from "./WorkflowCard";

// The two labelled sections of the workflows index: built-in pipelines and
// custom (org-saved) pipelines.

export function BuiltinPipelines({ items }: { items: WorkflowDefinition[] }) {
  return (
    <section className="mt-6">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink/40">
        Built-in pipelines
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((w) => (
          <WorkflowCard
            key={w.key}
            href={`/console/workflows/${encodeURIComponent(w.key)}`}
            name={w.name}
            description={w.description}
            stepCount={w.steps.length}
            steps={w.steps}
          />
        ))}
      </div>
    </section>
  );
}

export function CustomPipelines({ items }: { items: CustomWorkflow[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink/40">
        Custom pipelines
      </h2>
      {items.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
          No custom workflows yet. Save one via POST /api/agent-workflows.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((w) => (
            <WorkflowCard
              key={w.id}
              href={`/console/workflows/${w.id}`}
              name={w.name}
              description={w.description}
              stepCount={w.definition.steps.length}
              steps={w.definition.steps}
            />
          ))}
        </div>
      )}
    </section>
  );
}
