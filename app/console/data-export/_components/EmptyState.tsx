import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: ReactNode;
}

// Centered placeholder shown when a list has no rows. Optional hint line and an
// action slot (e.g. a link to start the first export).
export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm text-ink/60">{title}</p>
      {hint ? <p className="mt-1 text-xs text-ink/40">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
