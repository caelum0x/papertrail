"use client";

// Reusable previous/next pager for the Security module lists. Renders nothing
// when everything fits on a single page.

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  unit?: string;
  unitPlural?: string;
}

export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
  unit = "item",
  unitPlural,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const label = total === 1 ? unit : unitPlural ?? `${unit}s`;

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <span>
        {total} {label}
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="text-accent disabled:text-ink/30"
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="text-accent disabled:text-ink/30"
        >
          Next
        </button>
      </div>
    </div>
  );
}
