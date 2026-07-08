import Link from "next/link";

interface DevelopersHeaderProps {
  title: string;
  subtitle: React.ReactNode;
  link?: { href: string; label: string };
}

// Header row for developer-portal pages: title + description on the left, an
// optional right-aligned back link (used on sub-pages).
export function DevelopersHeader({ title, subtitle, link }: DevelopersHeaderProps) {
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
