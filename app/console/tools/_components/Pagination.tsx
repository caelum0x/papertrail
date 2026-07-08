interface PaginationProps {
  page: number;
  totalPages: number;
  loading: boolean;
  onPage: (page: number) => void;
}

// Prev / page-indicator / next control. Renders nothing when there's a single
// page so callers can drop it in unconditionally.
export function Pagination({ page, totalPages, loading, onPage }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1 || loading}
        className="text-ink/60 hover:text-accent disabled:opacity-40"
      >
        ← Previous
      </button>
      <span className="text-ink/40">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages || loading}
        className="text-ink/60 hover:text-accent disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}
