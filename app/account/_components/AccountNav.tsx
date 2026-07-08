"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Left-rail navigation for the account center. Personal, per-user surfaces — kept
// separate from the org console's nav. Exact-match highlighting so the overview
// link isn't marked active on every sub-page.
const LINKS: { href: string; label: string; hint: string }[] = [
  { href: "/account", label: "Overview", hint: "Your account at a glance" },
  { href: "/account/profile", label: "Profile", hint: "Name, title, avatar" },
  { href: "/account/security", label: "Security", hint: "Password, sessions, MFA" },
  { href: "/account/tokens", label: "Access tokens", hint: "Personal API tokens" },
  { href: "/account/preferences", label: "Preferences", hint: "Theme and defaults" },
];

export function AccountNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Account" className="space-y-1">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`block rounded-md px-3 py-2 text-sm ${
              active
                ? "bg-accent/10 font-medium text-accent"
                : "text-ink/60 hover:bg-ink/5 hover:text-ink/80"
            }`}
          >
            <span className="block">{link.label}</span>
            <span className="block text-xs text-ink/40">{link.hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}
