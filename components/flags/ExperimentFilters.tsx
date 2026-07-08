"use client";

import type { ExperimentStatus } from "@/lib/flags/types";
import { EXPERIMENT_STATUSES } from "@/lib/flags/types";

// Status filter tabs for the experiment list. Controlled by the parent.
export function ExperimentFilters({
  status,
  onStatus,
}: {
  status: ExperimentStatus | "all";
  onStatus: (next: ExperimentStatus | "all") => void;
}) {
  const options: (ExperimentStatus | "all")[] = ["all", ...EXPERIMENT_STATUSES];
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const active = status === option;
        return (
          <button
            key={option}
            onClick={() => onStatus(option)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
              active
                ? "bg-accent/10 text-accent"
                : "text-ink/60 hover:bg-paper hover:text-ink"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
