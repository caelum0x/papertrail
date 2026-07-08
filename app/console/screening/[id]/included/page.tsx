"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchRecords, fetchSrProject } from "../../client";
import type {
  SrProjectWithCounts,
  SrRecord,
} from "@/app/api/sr-projects/lib/types";
import { Pagination } from "../../_components/Pagination";

const PAGE_SIZE = 20;

// Final "included" set for a review: records that survived both screening
// stages. Read-only; uses the existing records endpoint with status=included.
export default function IncludedRecordsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [project, setProject] = useState<SrProjectWithCounts | null>(null);
  const [records, setRecords] = useState<SrRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [projectResult, recordsResult] = await Promise.all([
      fetchSrProject(id),
      fetchRecords(id, "included", page, PAGE_SIZE),
    ]);
    if (projectResult.data) setProject(projectResult.data);
    if (recordsResult.error) {
      setError(recordsResult.error);
      setRecords([]);
      setTotal(0);
    } else {
      setRecords(recordsResult.data ?? []);
      setTotal(recordsResult.total);
    }
    setLoading(false);
  }, [id, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-3xl">
      <Link
        href={id ? `/console/screening/${id}` : "/console/screening"}
        className="text-sm text-accent hover:underline"
      >
        ← Back to screening
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            Included records
          </h1>
          {project ? (
            <p className="mt-1 text-sm text-ink/40">{project.name}</p>
          ) : null}
        </div>
        {id ? (
          <Link
            href={`/console/screening/${id}/prisma`}
            className="rounded-md border border-ink/15 bg-white px-4 py-2 text-sm text-ink/80 hover:bg-paper"
          >
            PRISMA flow
          </Link>
        ) : null}
      </div>

      <div className="mt-6 space-y-3">
        {loading ? (
          <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
            Loading included records...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-ink/15 bg-white p-8 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={load}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
            No records have been included yet. Complete full-text screening to
            build the final set.
          </div>
        ) : (
          records.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-ink/15 bg-white p-4"
            >
              <h3 className="text-sm font-medium text-ink/80">{r.title}</h3>
              <p className="mt-0.5 text-xs uppercase tracking-wide text-ink/40">
                {r.sourceType}
                {r.externalId ? ` · ${r.externalId}` : ""}
              </p>
              {r.abstract ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink/60">
                  {r.abstract}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          unitLabel="included"
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
