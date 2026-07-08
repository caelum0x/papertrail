"use client";

// Simple prev/next pager shared by the flat tag table.

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="rounded border border-ink/15 px-2 py-1 text-ink/60 hover:border-accent disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-ink/40">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="rounded border border-ink/15 px-2 py-1 text-ink/60 hover:border-accent disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
