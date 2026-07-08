const PANEL_CLS =
  "rounded-lg border border-ink/10 bg-white p-8 text-center text-sm text-ink/40";

// Prompt shown before any query is typed.
export function SearchIdleState() {
  return <div className={PANEL_CLS}>Start typing to search your workspace.</div>;
}

// Loading indicator while a search is in flight.
export function SearchLoadingState() {
  return <div className={PANEL_CLS}>Searching...</div>;
}

interface SearchErrorStateProps {
  message: string;
  onRetry: () => void;
}

// Error panel with a retry action.
export function SearchErrorState({ message, onRetry }: SearchErrorStateProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-white p-6 text-center">
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

interface SearchEmptyStateProps {
  query: string;
}

// Empty state when a query returns no results.
export function SearchEmptyState({ query }: SearchEmptyStateProps) {
  return <div className={PANEL_CLS}>No results for “{query}”.</div>;
}
