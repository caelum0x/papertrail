"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, type ReferenceLibraryDto } from "./api";
import { LibraryList } from "./_components/LibraryList";
import { EmptyCard, ErrorCard } from "./_components/StateCard";
import { Pagination } from "./_components/Pagination";

const PAGE_LIMIT = 20;

export default function ReferenceLibrariesPage() {
  const [libraries, setLibraries] = useState<ReferenceLibraryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    const res = await apiGet<ReferenceLibraryDto[]>(
      `/api/reference-libraries?page=${p}&limit=${PAGE_LIMIT}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load libraries.");
      setLoading(false);
      return;
    }
    setLibraries(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Reference libraries</h1>
          <p className="mt-1 text-sm text-ink/40">
            Citation collections. Import and export BibTeX, RIS, or CSV.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/console/references/formats"
            className="text-sm text-ink/60 rounded px-3 py-2 hover:text-ink/80"
          >
            Formats
          </Link>
          <Link
            href="/console/references/new"
            className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
          >
            New library
          </Link>
        </div>
      </div>

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-ink/40">Loading libraries...</p>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => void load(page)} />
        ) : libraries.length === 0 ? (
          <EmptyCard
            title="No reference libraries yet."
            hint="Create your first library to start collecting citations."
          />
        ) : (
          <LibraryList libraries={libraries} />
        )}
      </div>

      {!loading && !error && total > PAGE_LIMIT ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
