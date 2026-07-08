import Link from "next/link";

interface PortalLink {
  href: string;
  title: string;
  description: string;
}

const LINKS: PortalLink[] = [
  {
    href: "/console/developers/webhooks",
    title: "Webhooks",
    description: "Get notified when a verification completes or is flagged.",
  },
  {
    href: "/console/developers/api",
    title: "API reference",
    description: "Interactive reference for the public verification API.",
  },
  {
    href: "/console/developers/keys",
    title: "API keys",
    description: "Create, review, and revoke keys for programmatic access.",
  },
];

// The developer portal's navigation cards linking to webhooks, the API
// reference, and the dedicated keys manager.
export function PortalLinks() {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="block bg-white border border-ink/10 rounded-lg p-5 hover:border-accent transition-colors"
        >
          <div className="text-sm font-medium text-ink/80">{link.title}</div>
          <p className="mt-1 text-xs text-ink/40">{link.description}</p>
        </Link>
      ))}
    </div>
  );
}
