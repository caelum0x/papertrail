"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchDefinitions } from "@/lib/reporting/client";
import type { ReportDefinition } from "@/lib/reporting/types";
import { ModuleHeader } from "./_components/ModuleHeader";
import { TypeFilter } from "./_components/TypeFilter";
import { ReportList } from "./_components/ReportList";
import { CreateReportCard } from "./_components/CreateReportCard";
import { StateBlock } from "./_components/StateBlock";
import { Pagination } from "./_components/Pagination";
import { useActiveOrgRole, canEdit } from "./_components/useActiveOrgRole";

const PAGE_SIZE = 20;

export default function ReportingListPage() {
  const role = useActiveOrgRole();
  const [type, setType] = useState<string>("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ReportDefinition[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchDefinitions(type || null, page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [type, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="Reporting"
        description="Design, run, and schedule org-scoped reports over your claims, reviews, and documents."
        actions={
          <Link
            href="/console/reporting/scheduled"
            className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
          >
            Scheduled
          </Link>
        }
      />

      <div className="mt-6">
        <CreateReportCard canEdit={canEdit(role)} />
      </div>

      <TypeFilter
        value={type}
        onChange={(t) => {
          setType(t);
          setPage(1);
        }}
      />

      <div className="mt-4 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <StateBlock kind="loading" message="Loading reports..." />
        ) : error ? (
          <StateBlock kind="error" message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <StateBlock
            kind="empty"
            message={
              type
                ? "No reports of this type yet."
                : "No reports yet. Create one to get started."
            }
          />
        ) : (
          <ReportList definitions={items} />
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
