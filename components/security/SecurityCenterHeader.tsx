import Link from "next/link";

// Shared page header for the Security Center surfaces. Renders a breadcrumb
// trail (Settings / Security Center / <section>), a title, and a subtitle, with
// an optional right-aligned action slot for page-level buttons.

interface Crumb {
  label: string;
  href?: string;
}

interface SecurityCenterHeaderProps {
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  action?: React.ReactNode;
}

export function SecurityCenterHeader({
  title,
  subtitle,
  crumbs,
  action,
}: SecurityCenterHeaderProps) {
  const trail: Crumb[] = crumbs ?? [
    { label: "Settings", href: "/console/settings" },
    { label: "Security Center", href: "/console/settings/security-center" },
  ];

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <nav className="text-xs text-ink/40" aria-label="Breadcrumb">
          {trail.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {i > 0 ? " / " : null}
              {c.href ? (
                <Link href={c.href} className="hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <h1 className="mt-1 text-2xl font-semibold text-ink/80">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-ink/40">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
