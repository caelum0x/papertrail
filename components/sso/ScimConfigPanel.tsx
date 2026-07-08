"use client";

import { useCallback, useEffect, useState } from "react";
import type { ScimDirectory } from "@/lib/sso/types";
import {
  fetchDirectories,
  createDirectory,
  deleteDirectory,
} from "@/components/sso/api";
import { StatusBadge } from "@/components/sso/StatusBadge";
import { EmptyState } from "@/components/sso/EmptyState";

// SCIM provisioning panel: list the org's SCIM directories, provision a new one
// (revealing the bearer token exactly once), and revoke existing ones. Used as
// the "Provisioning" tab of the connection detail. Self-contained data + states.

const SCIM_BASE_HINT = "/api/scim/v2 (configure this in your IdP)";

export function ScimConfigPanel() {
  const [items, setItems] = useState<ScimDirectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: rows } = await fetchDirectories({ limit: 100 });
      setItems(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load directories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    setNewToken(null);
    try {
      const { directory, bearerToken } = await createDirectory();
      setItems((prev) => [directory, ...prev]);
      setNewToken(bearerToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create directory.");
    } finally {
      setCreating(false);
    }
  }, []);

  const onDelete = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await deleteDirectory(id);
      setItems((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke directory.");
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink/70">SCIM 2.0 provisioning</p>
          <p className="mt-1 text-xs text-ink/40">
            Point your IdP at{" "}
            <span className="font-mono">{SCIM_BASE_HINT}</span> and use a bearer
            token below to auto-provision and de-provision members.
          </p>
        </div>
        <button
          onClick={onCreate}
          disabled={creating}
          className="text-sm border border-ink/15 rounded px-3 py-1.5 hover:border-accent disabled:opacity-50 shrink-0"
        >
          {creating ? "Creating…" : "New directory"}
        </button>
      </div>

      {newToken ? (
        <div className="bg-amber-50 border border-amber-600/30 rounded-lg p-4">
          <p className="text-sm text-amber-800">
            Copy this bearer token now — it won&rsquo;t be shown again.
          </p>
          <pre className="mt-2 text-xs bg-white border border-ink/10 rounded p-3 overflow-x-auto">
            {newToken}
          </pre>
          <button
            onClick={() => setNewToken(null)}
            className="mt-2 text-xs text-ink/60 hover:text-accent"
          >
            I&rsquo;ve saved it
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-ink/40">Loading directories…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No SCIM directories"
          message="Create one to enable automated user provisioning from your IdP."
        />
      ) : (
        <ul className="divide-y divide-ink/10 bg-white border border-ink/10 rounded-lg overflow-hidden">
          {items.map((d) => (
            <li
              key={d.id}
              className="px-4 py-3 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink/80 truncate">{d.name}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="text-xs text-ink/40">
                  {d.lastSyncAt
                    ? `Last sync ${new Date(d.lastSyncAt).toLocaleString()}`
                    : "Never synced"}
                </div>
              </div>
              <button
                onClick={() => onDelete(d.id)}
                disabled={busyId === d.id}
                className="text-xs text-red-600 hover:underline disabled:opacity-40 shrink-0"
              >
                {busyId === d.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
