import type { ReactNode } from "react";

// Reusable loading / error / empty panels for the workflows module so every
// page renders those states with the same shell.

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
      {label}
    </div>
  );
}

export function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-8 text-center">
      <p className="text-sm text-red-700">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 text-sm text-accent hover:underline"
      >
        Try again
      </button>
    </div>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
      {children}
    </div>
  );
}
