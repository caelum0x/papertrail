import Link from "next/link";

// Loading / error / empty states for the claims list, styled to sit inside the
// bordered list container.

export function ListLoading() {
  return (
    <div className="p-8 text-center text-sm text-ink/40">Loading claims...</div>
  );
}

export function ListError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-8 text-center">
      <p className="text-sm text-red-700">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 text-sm font-medium text-accent hover:underline"
      >
        Retry
      </button>
    </div>
  );
}

export function ListEmpty() {
  return (
    <div className="p-8 text-center">
      <p className="text-sm text-ink/40">
        No claims found. Submit one to get started.
      </p>
      <Link
        href="/console/claims/new"
        className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
      >
        New claim
      </Link>
    </div>
  );
}
