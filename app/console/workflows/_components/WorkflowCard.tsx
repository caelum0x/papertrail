import Link from "next/link";
import { StepPills } from "./StepPills";

// A single workflow card (built-in or custom) linking to its detail page.

interface WorkflowCardProps {
  href: string;
  name: string;
  description?: string | null;
  stepCount: number;
  steps: { name: string }[];
}

export function WorkflowCard({
  href,
  name,
  description,
  stepCount,
  steps,
}: WorkflowCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-ink/15 bg-white p-5 hover:border-accent/40"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink/80">{name}</h3>
        <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-ink/40">
          {stepCount} steps
        </span>
      </div>
      {description ? (
        <p className="mt-1.5 text-sm text-ink/60">{description}</p>
      ) : null}
      <StepPills steps={steps} />
    </Link>
  );
}
