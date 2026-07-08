import type { ReactNode } from "react";

// Loading / error / empty presentational helpers shared by the connectors pages.

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

// Standard loading/error/empty branching for a list body.
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
