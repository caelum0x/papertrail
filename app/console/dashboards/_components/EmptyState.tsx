import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

// Shared empty-state block for lists and grids with no rows yet.
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm font-medium text-ink/60">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink/40">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
