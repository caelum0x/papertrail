// Reusable empty-state card for the help module's list/detail views. Purely
// presentational: a title, an optional hint line, and an optional action node.
import type { ReactNode } from "react";

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-white border border-ink/10 rounded-lg p-8 text-center">
      <p className="text-sm text-ink/60">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink/40">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
