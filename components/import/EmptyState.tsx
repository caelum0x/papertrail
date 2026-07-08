import Link from "next/link";

// Shared empty state for the history table and rows table.
export function EmptyState({
  title,
  hint,
  cta,
}: {
  title: string;
  hint?: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-8 text-center">
      <p className="text-sm text-ink/60">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink/40">{hint}</p> : null}
      {cta ? (
        <Link
          href={cta.href}
          className="mt-4 inline-block rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
