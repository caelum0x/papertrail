import type { ReactNode } from "react";

// Neutral empty-state card for lists with no rows.

interface EmptyStateProps {
  title: string;
  hint?: ReactNode;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-8 text-center">
      <p className="text-sm text-ink/60">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink/40">{hint}</p> : null}
    </div>
  );
}
