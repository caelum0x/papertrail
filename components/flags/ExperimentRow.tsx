"use client";

import type { Experiment } from "@/lib/flags/types";
import { KeyChip, StatusBadge, relativeTime } from "@/components/flags/ui";
import { VariantPanel } from "@/components/flags/VariantPanel";

// One experiment card in the list, expandable to show its variant split.
export function ExperimentRow({
  experiment,
  expanded,
  onToggle,
}: {
  experiment: Experiment;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-ink/10 last:border-0">
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-3 py-3 text-left text-sm transition-colors hover:bg-paper"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyChip value={experiment.key} />
            <span className="truncate font-medium text-ink">
              {experiment.name}
            </span>
          </div>
        </div>
        <span className="w-20 text-right text-xs text-ink/50">
          {experiment.variants.length}{" "}
          {experiment.variants.length === 1 ? "variant" : "variants"}
        </span>
        <div className="w-24 text-right">
          <StatusBadge status={experiment.status} />
        </div>
        <span className="w-20 text-right text-[11px] text-ink/40">
          {relativeTime(experiment.createdAt)}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-ink/5 bg-paper/30 px-3 py-3">
          <VariantPanel variants={experiment.variants} />
        </div>
      )}
    </div>
  );
}
