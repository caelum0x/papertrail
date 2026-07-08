import Link from "next/link";

interface ModuleHeaderProps {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

// Reusable page header for the Saved views module: title + subtitle on the left,
// up to two actions on the right. Shared across list and detail pages so headers
// stay visually consistent.
export function ModuleHeader({
  title,
  description,
  actionHref,
  actionLabel,
  secondaryHref,
  secondaryLabel,
}: ModuleHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        <p className="mt-1 text-sm text-ink/40">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {secondaryHref && secondaryLabel ? (
          <Link
            href={secondaryHref}
            className="text-sm border border-ink/15 text-ink/70 rounded px-3 py-2 hover:border-accent"
          >
            {secondaryLabel}
          </Link>
        ) : null}
        {actionHref && actionLabel ? (
          <Link
            href={actionHref}
            className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
          >
            {actionLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
