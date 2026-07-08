"use client";

import Link from "next/link";
import { EXPORT_SCOPES, type ExportScope } from "@/lib/dataexport/schemas";
import type { DataExport } from "@/lib/dataexport/types";
import { ExportHistoryTable } from "./ExportHistoryTable";
import { EmptyState } from "./EmptyState";
import { Pagination } from "./Pagination";
import { SCOPE_LABELS } from "./shared";

interface ExportHistoryProps {
  items: DataExport[];
  loading: boolean;
  error: string | null;
  scope: ExportScope | "all";
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onScopeChange: (scope: ExportScope | "all") => void;
  onRetry: () => void;
  onPrev: () => void;
  onNext: () => void;
}

// The export history panel: a scope filter (Filters), the results table with
// loading / error / empty states, and pagination. Composes ExportHistoryTable,
// EmptyState and Pagination.
export function ExportHistory({
  items,
  loading,
  error,
  scope,
  page,
  totalPages,
  total,
  pageSize,
  onScopeChange,
  onRetry,
  onPrev,
  onNext,
}: ExportHistoryProps) {
  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-ink/80">Export history</h2>
        {/* Filters */}
        <label className="flex items-center gap-2 text-xs text-ink/50">
          Scope
          <select
            value={scope}
            onChange={(e) => onScopeChange(e.target.value as ExportScope | "all")}
            className="rounded-md border border-ink/15 bg-white px-2 py-1 text-sm text-ink/70"
          >
            <option value="all">All</option>
            {EXPORT_SCOPES.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <div className="p-10 text-center text-sm text-ink/40">
            Loading exports…
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={onRetry}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No exports yet."
            hint="Start an export to download your workspace data."
            action={
              <Link
                href="/console/data-export/new"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                New export
              </Link>
            }
          />
        ) : (
          <ExportHistoryTable items={items} />
        )}
      </div>

      {!loading && !error && total > pageSize ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={onPrev}
          onNext={onNext}
        />
      ) : null}
    </section>
  );
}
