"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Verify" },
  { href: "/batch", label: "Batch" },
  { href: "/compare", label: "Compare" },
  { href: "/sources", label: "Sources" },
  { href: "/recent", label: "Recent" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/eval", label: "Accuracy" },
  { href: "/api-docs", label: "API" },
  { href: "/connect", label: "Claude Science" },
  { href: "/about", label: "About" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="sticky top-0 z-10 border-b border-ink/10 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3 overflow-x-auto">
        <Link href="/" className="mr-3 shrink-0 flex items-center gap-2 font-semibold text-ink">
          <Image src="/logo.png" alt="PaperTrail" width={30} height={20} priority className="h-6 w-auto" />
          PaperTrail
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`shrink-0 rounded-md px-2.5 py-1 text-sm transition ${
                isActive(pathname, link.href)
                  ? "bg-ink/10 font-medium text-ink"
                  : "text-ink/60 hover:bg-ink/5 hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
