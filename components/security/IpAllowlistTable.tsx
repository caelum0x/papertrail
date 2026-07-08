"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import type { IpAllowlistEntry } from "@/lib/security/types";
import { fetchIpAllowlist, deleteIpEntry } from "./api";
import { LoadingState, ErrorState, EmptyState } from "./StateViews";
import { IpAllowlistRow } from "./IpAllowlistRow";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 20;

// Imperative handle so the parent page can push a newly-added entry into the
// table (from AddIpForm) without a full refetch, and trigger reloads.
export interface IpAllowlistTableHandle {
  prepend: (entry: IpAllowlistEntry) => void;
  reload: () => void;
}

// Paginated table of the org's IP allowlist entries. Owns fetch + delete +
// loading/error/empty states. Deletions are optimistic with rollback.
export const IpAllowlistTable = forwardRef<IpAllowlistTableHandle>(
  function IpAllowlistTable(_props, ref) {
    const [items, setItems] = useState<IpAllowlistEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [rowError, setRowError] = useState<string | null>(null);

    const load = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchIpAllowlist({ page, limit: PAGE_SIZE });
        setItems(res.items);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    }, [page]);

    useEffect(() => {
      void load();
    }, [load]);

    useImperativeHandle(
      ref,
      () => ({
        prepend: (entry: IpAllowlistEntry) => {
          // Only visually prepend on the first page; otherwise reload to keep
          // pagination consistent.
          if (page === 1) {
            setItems((cur) => [entry, ...cur]);
            setTotal((t) => t + 1);
          } else {
            setPage(1);
          }
        },
        reload: () => void load(),
      }),
      [page, load]
    );

    const onDelete = useCallback(
      async (id: string) => {
        setDeletingId(id);
        setRowError(null);
        const prev = items;
        setItems((cur) => cur.filter((e) => e.id !== id));
        setTotal((t) => Math.max(0, t - 1));
        try {
          await deleteIpEntry(id);
        } catch (err) {
          setItems(prev);
          setTotal(prev.length);
          setRowError(
            err instanceof Error ? err.message : "Couldn't remove the entry."
          );
        } finally {
          setDeletingId(null);
        }
      },
      [items]
    );

    if (loading) return <LoadingState label="Loading allowlist…" />;
    if (error) return <ErrorState message={error} onRetry={load} />;
    if (items.length === 0) {
      return (
        <EmptyState
          title="No IP restrictions"
          description="Add a CIDR range above to restrict access to specific networks. An empty allowlist allows all IPs."
        />
      );
    }

    return (
      <div>
        {rowError ? (
          <p className="mb-2 text-sm text-red-600">{rowError}</p>
        ) : null}
        <div className="bg-white border border-ink/15 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-ink/60">
                <th className="px-4 py-3 font-medium">CIDR range</th>
                <th className="px-4 py-3 font-medium">Note</th>
                <th className="px-4 py-3 font-medium">Added</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {items.map((entry) => (
                <IpAllowlistRow
                  key={entry.id}
                  entry={entry}
                  busy={deletingId === entry.id}
                  onDelete={onDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          unit="entry"
          unitPlural="entries"
        />
      </div>
    );
  }
);
