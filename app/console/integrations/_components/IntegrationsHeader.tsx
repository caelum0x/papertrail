import Link from "next/link";

interface IntegrationsHeaderProps {
  title: string;
  subtitle: string;
  link?: { href: string; label: string };
}

// Header row for the integrations module: title + description, optional back
// link on the right (used by sub-pages).
export function IntegrationsHeader({
  title,
  subtitle,
  link,
}: IntegrationsHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        <p className="mt-1 text-sm text-ink/40">{subtitle}</p>
      </div>
      {link ? (
        <Link
          href={link.href}
          className="shrink-0 text-sm text-ink/60 hover:text-accent"
        >
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}
