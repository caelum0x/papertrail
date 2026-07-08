interface ErrorCardProps {
  message: string;
  onRetry: () => void;
}

// White card wrapper for an inline error with a retry button.
export function ErrorCard({ message, onRetry }: ErrorCardProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-5">
      <p className="text-sm text-red-600">{message}</p>
      <button onClick={onRetry} className="mt-2 text-sm text-accent">
        Retry
      </button>
    </div>
  );
}

interface EmptyCardProps {
  title: string;
  hint?: string;
}

// White card wrapper for an empty state.
export function EmptyCard({ title, hint }: EmptyCardProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-8 text-center">
      <p className="text-sm text-ink/60">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink/40">{hint}</p> : null}
    </div>
  );
}
