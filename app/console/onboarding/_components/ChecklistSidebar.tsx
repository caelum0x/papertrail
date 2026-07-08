"use client";

import type { Checklist, StepId } from "./types";

// Sidebar that mirrors the wizard's step list as a checklist. Each row shows a
// done/undone marker, is clickable to jump to that step, and highlights the step
// the wizard is currently on. Optional steps are labelled so users know they can
// skip them without blocking completion.

interface ChecklistSidebarProps {
  checklist: Checklist | null;
  currentStep: StepId;
  onJump: (step: StepId) => void;
}

function Marker({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={[
        "flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px]",
        done
          ? "bg-accent text-white"
          : "border border-ink/20 bg-white text-transparent",
      ].join(" ")}
    >
      {done ? "✓" : ""}
    </span>
  );
}

export function ChecklistSidebar({
  checklist,
  currentStep,
  onJump,
}: ChecklistSidebarProps) {
  if (!checklist) {
    return (
      <aside className="rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-sm text-ink/40">Loading checklist…</p>
      </aside>
    );
  }

  return (
    <aside className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-medium text-ink/80">Setup checklist</h2>
      <ul className="mt-4 space-y-1">
        {checklist.items.map((item) => {
          const active = item.id === currentStep;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onJump(item.id)}
                aria-current={active ? "step" : undefined}
                className={[
                  "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors",
                  active ? "bg-accent/10" : "hover:bg-ink/5",
                ].join(" ")}
              >
                <Marker done={item.done} />
                <span className="min-w-0">
                  <span
                    className={[
                      "block text-sm",
                      item.done ? "text-ink/80" : "text-ink/60",
                    ].join(" ")}
                  >
                    {item.title}
                    {item.optional ? (
                      <span className="ml-1.5 text-xs text-ink/40">
                        (optional)
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {checklist.completed ? (
        <p className="mt-4 rounded border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent">
          Setup complete — you can revisit any step anytime.
        </p>
      ) : null}
    </aside>
  );
}
