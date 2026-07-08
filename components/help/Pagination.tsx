"use client";

// Simple prev/next pager shared by the help module's list views.
export function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <button onClick={onPrev} disabled={page <= 1} className="disabled:opacity-40">
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={page >= totalPages}
        className="disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
