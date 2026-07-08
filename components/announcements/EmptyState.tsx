// Shared empty-state block for the announcements module. Purely presentational.
import type { ReactNode } from "react";

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-8 text-center">
      <p className="text-sm font-medium text-ink/70">{title}</p>
      {message ? <p className="mt-1 text-sm text-ink/40">{message}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
