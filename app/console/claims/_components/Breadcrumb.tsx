import Link from "next/link";

// Two-segment breadcrumb ("Claims / <leaf>") used across claim sub-pages.

export function Breadcrumb({ leaf }: { leaf: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink/40">
      <Link href="/console/claims" className="hover:text-accent">
        Claims
      </Link>
      <span>/</span>
      <span className="text-ink/60">{leaf}</span>
    </div>
  );
}
