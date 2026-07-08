"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ExportScope } from "@/lib/dataexport/schemas";
import type { DataExport } from "@/lib/dataexport/types";
import { fetchExports } from "./_components/api";
import { useRole } from "./_components/useRole";
import { ModuleHeader } from "./_components/ModuleHeader";
import { StartExportCard } from "./_components/StartExportCard";
import { ExportHistory } from "./_components/ExportHistory";

const PAGE_SIZE = 20;

// Data export center overview: a start-export CTA plus the org's export history
// (ExportHistory = Filters + Table + EmptyState + Pagination).
export default function DataExportPage() {
  const { canEdit } = useRole();

  const [items, setItems] = useState<DataExport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<ExportScope | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchExports(
      page,
      PAGE_SIZE,
      scope === "all" ? undefined : scope
    );
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page, scope]);

  useEffect(() => {
    load();
  }, [load]);

  const onScopeChange = (next: ExportScope | "all") => {
    setPage(1);
    setScope(next);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Data export center"
        description="Export your workspace's claims, verifications, evidence, documents, and references to CSV or JSON."
        actions={
          canEdit ? (
            <Link
              href="/console/data-export/new"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              New export
            </Link>
          ) : null
        }
      />

      <StartExportCard canEdit={canEdit} />

      <ExportHistory
        items={items}
        loading={loading}
        error={error}
        scope={scope}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onScopeChange={onScopeChange}
        onRetry={load}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
    </div>
  );
}
