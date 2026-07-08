interface StateBlockProps {
  kind: "loading" | "error" | "empty";
  message: string;
  onRetry?: () => void;
}

// Uniform loading / error / empty panel used across the reporting module.
export function StateBlock({ kind, message, onRetry }: StateBlockProps) {
  return (
    <div className="p-8 text-center">
      <p className={`text-sm ${kind === "error" ? "text-red-700" : "text-ink/40"}`}>
        {message}
      </p>
      {kind === "error" && onRetry ? (
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
