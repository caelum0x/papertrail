// Inline chain of step-name pills shown on workflow cards.

interface StepPillsProps {
  steps: { name: string }[];
}

export function StepPills({ steps }: StepPillsProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => (
        <span key={`${s.name}-${i}`} className="flex items-center gap-1.5">
          {i > 0 ? <span className="text-ink/30">→</span> : null}
          <span className="rounded-md border border-ink/10 bg-paper px-2 py-0.5 text-xs text-ink/60">
            {s.name}
          </span>
        </span>
      ))}
    </div>
  );
}
