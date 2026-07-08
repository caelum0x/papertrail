import type { ReactNode } from "react";

interface ModuleHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

// Page header shared across the data export center pages: a title, a one-line
// description, and an optional actions slot (e.g. a "New export" link).
export function ModuleHeader({ title, description, actions }: ModuleHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink/10 pb-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink/50">{description}</p>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
