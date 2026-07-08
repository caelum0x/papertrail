"use client";

import type { ExperimentVariant } from "@/lib/flags/types";

// Renders an experiment's variants with their relative traffic share, computed
// from the weights. Purely presentational.
export function VariantPanel({ variants }: { variants: ExperimentVariant[] }) {
  const total = variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);

  if (variants.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-ink/10 bg-paper px-3 py-3 text-center text-xs text-ink/40">
        No variants configured.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {variants.map((variant) => {
        const share = total > 0 ? Math.round((variant.weight / total) * 100) : 0;
        return (
          <div key={variant.key} className="text-sm">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs text-ink/70">
                  {variant.key}
                </code>
                <span className="text-ink/70">{variant.name}</span>
              </div>
              <span className="tabular-nums text-xs text-ink/50">{share}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${share}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
