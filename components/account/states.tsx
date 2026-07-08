import type { ReactNode } from "react";

// Small shared loading / empty / error presentational states used across the
// account center pages so every list and panel handles the three async states
// identically.

// A row of shimmer placeholders standing in for content while a fetch is in flight.
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-md border border-ink/10 bg-ink/5"
        />
      ))}
    </div>
  );
}

// Centered placeholder shown when a list has no rows. Optional hint + action slot.
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="p-8 text-center">
      <p className="text-sm text-ink/60">{title}</p>
      {hint ? <p className="mt-1 text-xs text-ink/40">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// Inline error state with an optional retry affordance.
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center">
      <p className="text-sm text-red-700">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
