import type { ReactNode } from "react";

interface ModuleHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

// Standard header for the signatures module pages: title, one-line description,
// and an optional actions slot on the right.
export function ModuleHeader({ title, description, actions }: ModuleHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink/10 pb-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink/60">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
