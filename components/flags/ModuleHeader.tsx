"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Header + sub-navigation shared by the flags & experiments pages. Keeps the
// tabs in one place so each page.tsx just composes its own body.

const TABS: { href: string; label: string }[] = [
  { href: "/console/admin/flags", label: "Feature flags" },
  { href: "/console/admin/experiments", label: "Experiments" },
];

export function ModuleHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="border-b border-ink/10 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-ink/60">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <nav className="mt-4 flex gap-1">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-accent/10 text-accent"
                  : "text-ink/60 hover:bg-paper hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
