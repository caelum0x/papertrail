"use client";

import type { StepId } from "./types";

// Horizontal step indicator across the top of the wizard. Shows the ordered steps
// with their number, marking completed (from state) and the currently-active one.

interface StepDef {
  id: StepId;
  title: string;
}

interface StepperProps {
  steps: StepDef[];
  currentIndex: number;
  doneIds: Set<StepId>;
}

export function Stepper({ steps, currentIndex, doneIds }: StepperProps) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((step, i) => {
        const active = i === currentIndex;
        const done = doneIds.has(step.id) && !active;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={[
                "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                active
                  ? "bg-accent text-white"
                  : done
                    ? "bg-accent/20 text-accent"
                    : "border border-ink/10 bg-paper text-ink/60",
              ].join(" ")}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={[
                "text-sm",
                active ? "text-ink/80" : "text-ink/60",
              ].join(" ")}
            >
              {step.title}
            </span>
            {i < steps.length - 1 ? (
              <span aria-hidden className="mx-1 h-px w-6 bg-ink/10" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
