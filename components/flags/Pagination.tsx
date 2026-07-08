"use client";

// Simple prev/next pager shared by the flag and experiment lists.

export function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between border-t border-ink/10 px-1 py-3 text-sm text-ink/60">
      <span className="tabular-nums">
        {start}–{end} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded border border-ink/10 px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-paper"
        >
          Previous
        </button>
        <span className="tabular-nums text-xs text-ink/40">
          Page {page} / {totalPages}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded border border-ink/10 px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-paper"
        >
          Next
        </button>
      </div>
    </div>
  );
}
