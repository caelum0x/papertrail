"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { AuditHeader } from "./_components/AuditHeader";
import { AuditFilters } from "./_components/AuditFilters";
import { AuditList } from "./_components/AuditList";
import { AuditPagination } from "./_components/AuditPagination";
import { AuditNoAccess } from "./_components/AuditNoAccess";
import {
  buildAuditQuery,
  PAGE_SIZE,
  type AuditFilterOptions,
  type AuditListResponse,
  type AuditLogEntry,
} from "./_components/types";

export default function AuditPage() {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [filters, setFilters] = useState<AuditFilterOptions>({
    actions: [],
    entityTypes: [],
    users: [],
  });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [userId, setUserId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = buildAuditQuery(page, action, entityType, userId);
    const res = await getJson<AuditListResponse>(`/api/audit?${query}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load audit log.");
      setLoading(false);
      return;
    }
    setEntries(res.data.entries);
    setFilters(res.data.filters);
    setTotal(res.meta?.total ?? res.data.entries.length);
    setLoading(false);
  }, [page, action, entityType, userId]);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  const onFilterChange = useCallback(
    (setter: (v: string) => void) =>
      (e: React.ChangeEvent<HTMLSelectElement>) => {
        setPage(1);
        setter(e.target.value);
      },
    []
  );

  const onClear = useCallback(() => {
    setAction("");
    setEntityType("");
    setUserId("");
    setPage(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!roleLoading && !canManage) {
    return <AuditNoAccess />;
  }

  return (
    <div>
      <AuditHeader />

      <AuditFilters
        filters={filters}
        action={action}
        entityType={entityType}
        userId={userId}
        onActionChange={onFilterChange(setAction)}
        onEntityTypeChange={onFilterChange(setEntityType)}
        onUserIdChange={onFilterChange(setUserId)}
        onClear={onClear}
      />

      <AuditList entries={entries} loading={loading} error={error} />

      {!loading && !error && total > PAGE_SIZE ? (
        <AuditPagination
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
