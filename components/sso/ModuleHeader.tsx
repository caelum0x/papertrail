import Link from "next/link";

// Reusable header for the SSO settings surfaces: a title, a short description,
// and an optional back link + action slot. Presentational only.

interface ModuleHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
}

export function ModuleHeader({
  title,
  description,
  backHref,
  backLabel,
  action,
}: ModuleHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {backHref ? (
          <Link
            href={backHref}
            className="text-xs text-ink/50 hover:text-accent"
          >
            ← {backLabel ?? "Back"}
          </Link>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold text-ink/80">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-ink/60">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
