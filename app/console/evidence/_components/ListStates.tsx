// Loading / error / empty states for the evidence library list.

import { Skeleton } from "@/components/console/ui";

// Skeleton rows that mirror the loaded list layout, so the load reads as "populating"
// rather than a bare "Loading…" line.
export function ListLoading() {
  return (
    <div className="divide-y divide-ink/10 rounded-lg border border-ink/15 bg-white">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
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
    <div className="bg-white border border-red-200 rounded-lg p-6 text-center">
      <p className="text-sm text-red-600">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 text-sm text-accent hover:underline"
      >
        Try again
      </button>
    </div>
  );
}

export function ListEmpty() {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
      No evidence yet. Add your first source to build the library.
    </div>
  );
}
