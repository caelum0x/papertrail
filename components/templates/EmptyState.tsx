import Link from "next/link";

interface EmptyStateProps {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}

// Neutral empty-state panel shared across list/detail views when there's nothing
// to show yet. Optional action nudges the user toward creating something.
export function EmptyState({
  title,
  message,
  actionHref,
  actionLabel,
}: EmptyStateProps) {
  return (
    <div className="bg-white border border-ink/10 rounded-lg p-8 text-center">
      <p className="text-sm font-medium text-ink/70">{title}</p>
      <p className="mt-1 text-sm text-ink/40">{message}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-4 inline-block text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
