// Prev/Next pager shared across screening list views.

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  unitLabel?: string;
  onPrev: () => void;
  onNext: () => void;
}

export function Pagination({
  page,
  totalPages,
  total,
  unitLabel = "total",
  onPrev,
  onNext,
}: PaginationProps) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <span>
        Page {page} of {totalPages} · {total} {unitLabel}
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="rounded-md border border-ink/15 bg-white px-3 py-1.5 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded-md border border-ink/15 bg-white px-3 py-1.5 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
