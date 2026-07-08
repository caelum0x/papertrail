// Small shared state components for the Security module: loading, error (with a
// retry affordance), and empty states. Keeping them in one file avoids
// re-implementing the same boxed placeholder in every page.

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <div
      className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40"
      role="status"
      aria-live="polite"
    >
      {label}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="bg-white border border-red-200 rounded-lg p-6 text-center">
      <p className="text-sm text-red-600">{message}</p>
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

interface EmptyStateProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-8 text-center">
      <p className="text-sm font-medium text-ink/70">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-ink/40">{description}</p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
