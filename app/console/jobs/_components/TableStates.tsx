import type { ReactNode } from "react";

// Card wrapper and centered state messages shared by the jobs and schedules tables.
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

interface SimplePaginationProps {
  page: number;
  totalPages: number;
  total: number;
  noun: string;
  onPrev: () => void;
  onNext: () => void;
}

export function SimplePagination({
  page,
  totalPages,
  total,
  noun,
  onPrev,
  onNext,
}: SimplePaginationProps) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <span>
        Page {page} of {totalPages} · {total} {noun}(s)
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="rounded-md border border-ink/15 bg-white px-3 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <button
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded-md border border-ink/15 bg-white px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
