import Link from "next/link";

export interface QuickLink {
  href: string;
  label: string;
  desc: string;
}

interface QuickLinksProps {
  links: QuickLink[];
}

// Grid of navigational cards linking to admin sub-areas.
export function QuickLinks({ links }: QuickLinksProps) {
  return (
    <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="block bg-white border border-ink/10 rounded-lg p-5 hover:border-accent transition-colors"
        >
          <div className="text-sm font-medium text-ink/80">{link.label}</div>
          <div className="mt-1 text-xs text-ink/40">{link.desc}</div>
        </Link>
      ))}
    </div>
  );
}
