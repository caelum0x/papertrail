"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, type CustomRoleDTO } from "./api";
import { RoleRow } from "./RoleRow";
import { EmptyState } from "./EmptyState";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 20;

// LIST view: fetches custom roles and renders them in a table with pagination,
// loading/empty/error states, and inline delete.
export function RolesList() {
  const [roles, setRoles] = useState<CustomRoleDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    const res = await apiGet<CustomRoleDTO[]>(
      `/api/roles?page=${p}&limit=${PAGE_SIZE}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load roles.");
      setLoading(false);
      return;
    }
    setRoles(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const handleDelete = useCallback(
    async (role: CustomRoleDTO) => {
      if (!window.confirm(`Delete the role "${role.name}"?`)) return;
      setDeletingId(role.id);
      const res = await apiSend(`/api/roles/${role.id}`, "DELETE");
      setDeletingId(null);
      if (!res.success) {
        setError(res.error ?? "Failed to delete role.");
        return;
      }
      void load(page);
    },
    [load, page]
  );

  return (
    <section className="rounded-lg border border-ink/10 bg-white">
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink/70">Custom roles</h2>
        <Link
          href="/console/settings/roles/new"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          New role
        </Link>
      </div>

      {error ? (
        <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="p-6 text-sm text-ink/40">Loading roles…</div>
      ) : roles.length === 0 && !error ? (
        <div className="p-4">
          <EmptyState
            title="No custom roles yet"
            description="Create a role to bundle fine-grained permissions and assign them to teams or members."
            action={
              <Link
                href="/console/settings/roles/new"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Create your first role
              </Link>
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-ink/60">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Permissions</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {roles.map((role) => (
                <RoleRow
                  key={role.id}
                  role={role}
                  deleting={deletingId === role.id}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            total={total}
            limit={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      )}
    </section>
  );
}
