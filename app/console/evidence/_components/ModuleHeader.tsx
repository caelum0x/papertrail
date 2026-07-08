import type { ReactNode } from "react";

// Page header for the evidence module: title, subtitle, and an action slot.

interface ModuleHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function ModuleHeader({ title, subtitle, action }: ModuleHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink/40">{subtitle}</p> : null}
      </div>
      {action ?? null}
    </div>
  );
}
