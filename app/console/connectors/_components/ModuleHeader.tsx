import type { ReactNode } from "react";
import Link from "next/link";

interface ModuleHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

// Page-level header shared across the connectors module (mirrors the api-usage /
// reporting modules for a consistent console feel).
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

interface TabDef {
  href: string;
  label: string;
}

// Secondary nav shared by the module's pages. `active` is matched by href.
export function ModuleTabs({
  tabs,
  active,
}: {
  tabs: TabDef[];
  active: string;
}) {
  return (
    <nav className="mt-4 flex gap-1 border-b border-ink/10">
      {tabs.map((t) => {
        const isActive = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              isActive
                ? "border-b-2 border-accent px-3 py-2 text-sm font-medium text-ink/80"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-ink/50 hover:text-ink/80"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const CONNECTOR_TABS: TabDef[] = [
  { href: "/console/connectors", label: "Installed" },
  { href: "/console/connectors/catalog", label: "Catalog" },
];
