import Link from "next/link";
import type { DocLink } from "./types";

interface DocCardProps {
  link: DocLink;
}

export function DocCard({ link }: DocCardProps) {
  return (
    <Link
      href={link.href}
      className="block rounded-lg border border-ink/10 bg-white p-4 hover:border-accent"
    >
      <h3 className="text-base font-semibold text-ink">{link.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink/80">{link.description}</p>
      <code className="mt-2 inline-block rounded bg-ink/5 px-1 py-0.5 text-xs text-ink/60">
        {link.href}
      </code>
    </Link>
  );
}
