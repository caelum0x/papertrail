import Link from "next/link";
import { Skeleton } from "@/components/console/ui";

// Loading / error / empty states for the claims list, styled to sit inside the
// bordered list container.

// Skeleton rows that mirror the loaded claim rows, so the list reads as "populating"
// instead of a bare "Loading…" line inside the bordered container.
export function ListLoading() {
  return (
    <div className="divide-y divide-ink/10">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
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
