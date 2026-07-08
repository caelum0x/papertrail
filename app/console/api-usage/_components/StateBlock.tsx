import type { ReactNode } from "react";

// Small presentational helpers for the loading / error / empty states each page
// and table share. Keeps the page components focused on data flow.

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="p-8 text-center text-sm text-ink/40">{label}</div>;
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="p-8 text-center">
      <p className="text-sm text-red-700">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-3 text-sm text-accent hover:underline"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-ink/40">{children}</div>;
}

// Wraps a data table with the standard loading/error/empty branching so every
// list page renders these states identically.
export function TableStates<T>({
  loading,
  error,
  items,
  onRetry,
  emptyLabel,
  loadingLabel,
  children,
}: {
  loading: boolean;
  error: string | null;
  items: T[];
  onRetry: () => void;
  emptyLabel: string;
  loadingLabel?: string;
  children: ReactNode;
}) {
  if (loading) return <LoadingState label={loadingLabel} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (items.length === 0) return <EmptyState>{emptyLabel}</EmptyState>;
  return <>{children}</>;
}
