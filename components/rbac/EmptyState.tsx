import type { ReactNode } from "react";

// Shared empty-state placeholder used across RBAC list/grid views.
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-ink/15 bg-paper px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink/70">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink/40">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
