import type { ReactNode } from "react";

// Neutral centered card for loading/empty states in the signals module.
export function StateCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
      {children}
    </div>
  );
}

interface ErrorCardProps {
  message: string;
  onRetry: () => void;
}

// Error state card with a retry action.
export function ErrorCard({ message, onRetry }: ErrorCardProps) {
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
