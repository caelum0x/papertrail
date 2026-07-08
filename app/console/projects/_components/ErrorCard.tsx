// Error card with an optional retry action, matching the projects module styling.

interface ErrorCardProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorCard({ message, onRetry }: ErrorCardProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-5">
      <p className="text-sm text-red-600">{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className="mt-2 text-sm text-accent">
          Retry
        </button>
      ) : null}
    </div>
  );
}
