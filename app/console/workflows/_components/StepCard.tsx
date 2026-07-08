"use client";

import { useState } from "react";
import type { StepRow } from "@/lib/workflows/repository";
import { RunStatus } from "./RunStatus";
import { JsonBlock } from "./JsonBlock";

// Collapsible trace card for a single executed step. Auto-expands on failure.

interface StepCardProps {
  step: StepRow;
}

export function StepCard({ step }: StepCardProps) {
  const [open, setOpen] = useState(step.status === "failed");
  return (
    <li className="rounded-lg border border-ink/15 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-medium text-ink/60">
          {step.stepIndex + 1}
        </span>
        <span className="flex-1 text-sm font-medium text-ink/80">
          {step.name}
        </span>
        <span className="text-xs text-ink/40">
          {step.durationMs != null ? `${step.durationMs}ms` : ""}
          {step.tokens != null ? ` · ~${step.tokens} tok` : ""}
        </span>
        <RunStatus status={step.status} />
        <span className="text-ink/30">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="border-t border-ink/10 px-4 py-3">
          {step.error ? (
            <div className="mb-3 rounded-md border border-red-600/30 bg-red-50 p-3 text-sm text-red-700">
              {step.error}
            </div>
          ) : null}
          <div className="text-xs uppercase tracking-wide text-ink/40">
            Input
          </div>
          <JsonBlock value={step.input} />
          <div className="mt-3 text-xs uppercase tracking-wide text-ink/40">
            Output
          </div>
          <JsonBlock value={step.output} />
        </div>
      ) : null}
    </li>
  );
}
