import type { ReactNode } from "react";
import Link from "next/link";

// Header block for RBAC module pages: back link, title, subtitle, and an
// optional action slot (e.g. a "New role" button).
export function ModuleHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {backHref ? (
        <Link href={backHref} className="text-sm text-accent hover:underline">
          ← {backLabel ?? "Back"}
        </Link>
      ) : null}
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink/40">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
