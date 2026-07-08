// Shared page header for the announcements module: a title, subtitle, and an
// optional action slot on the right. Purely presentational.
import type { ReactNode } from "react";

export function ModuleHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink/40">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
