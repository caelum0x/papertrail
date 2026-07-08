// Loading / error / empty states for the evidence library list.

export function ListLoading() {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
      Loading evidence...
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
