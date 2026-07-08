import type { ReactNode } from "react";

// Rounded white card wrapper that hosts a table or a centered state message.
export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink/15 bg-white">
      {children}
    </div>
  );
}

export function TableLoading({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-ink/40">{children}</div>;
}

interface TableErrorProps {
  message: string;
  onRetry: () => void;
}

export function TableError({ message, onRetry }: TableErrorProps) {
  return (
    <div className="p-8 text-center">
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
