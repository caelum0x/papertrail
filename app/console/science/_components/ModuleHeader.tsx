import type { ReactNode } from "react";

// Page header for the science module: title, optional subtitle, and actions.

interface ModuleHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function ModuleHeader({ title, subtitle, actions }: ModuleHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink/40">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
}
