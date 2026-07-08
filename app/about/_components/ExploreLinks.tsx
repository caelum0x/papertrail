import Link from "next/link";

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Verify a claim →" },
  { href: "/sources", label: "Browse cached sources →" },
  { href: "/eval", label: "See the evaluation results →" },
  { href: "/console", label: "Open the workspace →" },
];

export function ExploreLinks() {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className="text-accent hover:underline">
          {link.label}
        </Link>
      ))}
    </div>
  );
}
