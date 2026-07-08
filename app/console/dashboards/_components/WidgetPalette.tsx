"use client";

import type { WidgetKind } from "./types";
import { WIDGET_KIND_LABELS } from "./shared";

interface WidgetPaletteProps {
  adding: boolean;
  onAdd: (kind: WidgetKind) => void;
}

const KIND_DESCRIPTIONS: Record<WidgetKind, string> = {
  metric: "A single KPI number (claims verified, trust score, distortion rate).",
  list: "Recent claims, documents, or verifications.",
  chart: "A bar chart series over time or by category.",
};

const KINDS: WidgetKind[] = ["metric", "list", "chart"];

// Palette of widget kinds that can be dropped onto the grid.
export function WidgetPalette({ adding, onAdd }: WidgetPaletteProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/70">Add widget</h2>
      <div className="mt-3 space-y-2">
        {KINDS.map((kind) => (
          <button
            key={kind}
            onClick={() => onAdd(kind)}
            disabled={adding}
            className="w-full rounded-md border border-ink/15 px-3 py-2 text-left hover:border-accent hover:bg-paper disabled:opacity-40"
          >
            <span className="block text-sm font-medium text-ink/70">
              {WIDGET_KIND_LABELS[kind]}
            </span>
            <span className="mt-0.5 block text-xs text-ink/40">
              {KIND_DESCRIPTIONS[kind]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
