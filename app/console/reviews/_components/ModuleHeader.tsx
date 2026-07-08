import type { ReactNode } from "react";

interface ModuleHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

// Page-level header used across the reviews module (queue + sub-pages).
export function ModuleHeader({ title, description, actions }: ModuleHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-ink/40">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
