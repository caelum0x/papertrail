"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchReviews } from "@/components/reviews/reviewClient";
import type { ReviewWithPeople } from "@/lib/reviews/types";
import { ModuleHeader } from "./_components/ModuleHeader";
import { FiltersBar } from "./_components/FiltersBar";
import { ReviewsTable } from "./_components/ReviewsTable";
import { StateBlock } from "./_components/StateBlock";
import { Pagination } from "./_components/Pagination";

const PAGE_SIZE = 20;

export default function ReviewsQueuePage() {
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ReviewWithPeople[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchReviews(scope, status || null, page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [scope, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="Reviews"
        description="Human review and approval queue for claims and verifications."
        actions={
          <Link
            href="/console/reviews/overview"
            className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
          >
            Overview
          </Link>
        }
      />

      <FiltersBar
        scope={scope}
        status={status}
        onScopeChange={(s) => {
          setScope(s);
          setPage(1);
        }}
        onStatusChange={(s) => {
          setStatus(s);
          setPage(1);
        }}
      />

      <div className="mt-4 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <StateBlock kind="loading" message="Loading reviews..." />
        ) : error ? (
          <StateBlock kind="error" message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <StateBlock
            kind="empty"
            message={
              scope === "mine"
                ? "No reviews are assigned to you."
                : "No reviews yet."
            }
          />
        ) : (
          <ReviewsTable items={items} />
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
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
