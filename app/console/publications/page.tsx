"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchPublications } from "./client";
import type { PublicationWithCounts } from "@/app/api/publications/lib/types";
import { PublicationsTable } from "./_components/PublicationsTable";
import { TablePagination } from "./_components/TablePagination";
import {
  TableCard,
  TableLoading,
  TableError,
} from "./_components/TableCard";

const PAGE_SIZE = 20;

export default function PublicationsPage() {
  const [items, setItems] = useState<PublicationWithCounts[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchPublications(page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Publications</h1>
          <p className="mt-1 text-sm text-ink/40">
            Plan manuscripts and congress outputs medical-writing style: attach
            verified claims, track their verification status, and gate release
            through MLR review.
          </p>
          <div className="mt-2">
            <Link
              href="/console/publications/overview"
              className="text-xs font-medium text-accent hover:underline"
            >
              View portfolio overview →
            </Link>
          </div>
        </div>
        <Link
          href="/console/publications/new"
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          New publication
        </Link>
      </div>

      <div className="mt-6">
        <TableCard>
          {loading ? (
            <TableLoading>Loading publications...</TableLoading>
          ) : error ? (
            <TableError message={error} onRetry={load} />
          ) : items.length === 0 ? (
            <TableLoading>
              No publications yet. Create one to start planning.
            </TableLoading>
          ) : (
            <PublicationsTable items={items} />
          )}
        </TableCard>
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
