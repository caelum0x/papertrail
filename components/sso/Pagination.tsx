"use client";

// Simple prev/next pager for the SSO module lists. Renders nothing when there's
// only a single page. Presentational — parent owns page state.

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  return (
    <div className="px-5 py-3 border-t border-ink/10 flex items-center justify-between text-xs text-ink/50">
      <span>
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="border border-ink/15 rounded px-3 py-1 disabled:opacity-40 hover:border-accent"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          className="border border-ink/15 rounded px-3 py-1 disabled:opacity-40 hover:border-accent"
        >
          Next
        </button>
      </div>
    </div>
  );
}
