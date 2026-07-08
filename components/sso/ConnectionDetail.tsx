"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SsoConnection } from "@/lib/sso/types";
import {
  fetchConnection,
  updateConnection,
  deleteConnection,
} from "@/components/sso/api";
import { DetailHeader } from "@/components/sso/DetailHeader";
import { Tabs, type TabDef } from "@/components/sso/Tabs";
import { ConfigPanel } from "@/components/sso/ConfigPanel";
import { DomainVerifyPanel } from "@/components/sso/DomainVerifyPanel";
import { ScimConfigPanel } from "@/components/sso/ScimConfigPanel";
import { ConnectionSidePanel } from "@/components/sso/ConnectionSidePanel";

// Detail container for a single SSO connection. Fetches the connection for the
// active org, then composes DetailHeader + Tabs + per-tab panels + SidePanel.
// Owns the shared lifecycle actions (activate/disable, delete) and the tab
// state; each panel handles its own sub-form.

const TABS: TabDef[] = [
  { id: "config", label: "Configuration" },
  { id: "domain", label: "Domain" },
  { id: "provisioning", label: "Provisioning" },
];

export function ConnectionDetail({ id }: { id: string }) {
  const router = useRouter();
  const [connection, setConnection] = useState<SsoConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("config");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConnection(await fetchConnection(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connection.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onToggleStatus = useCallback(async () => {
    if (!connection) return;
    const next = connection.status === "active" ? "disabled" : "active";
    setBusy(true);
    setActionError(null);
    try {
      const updated = await updateConnection(connection.id, { status: next });
      setConnection(updated);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to update status."
      );
    } finally {
      setBusy(false);
    }
  }, [connection]);

  const onDelete = useCallback(async () => {
    if (!connection) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteConnection(connection.id);
      router.push("/console/settings/sso");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to delete connection."
      );
      setBusy(false);
    }
  }, [connection, router]);

  if (loading) {
    return <p className="text-sm text-ink/40">Loading connection…</p>;
  }
  if (error || !connection) {
    return (
      <div>
        <p className="text-sm text-red-600">{error ?? "Connection not found."}</p>
        <button
          onClick={load}
          className="mt-2 text-xs text-ink/60 hover:text-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DetailHeader
        connection={connection}
        busy={busy}
        onToggleStatus={onToggleStatus}
        onDelete={onDelete}
      />
      {actionError ? (
        <p className="text-sm text-red-600">{actionError}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <div className="mt-5">
            {tab === "config" ? (
              <ConfigPanel connection={connection} onUpdated={setConnection} />
            ) : null}
            {tab === "domain" ? (
              <DomainVerifyPanel
                connection={connection}
                onUpdated={setConnection}
              />
            ) : null}
            {tab === "provisioning" ? <ScimConfigPanel /> : null}
          </div>
        </div>
        <ConnectionSidePanel connection={connection} />
      </div>
    </div>
  );
}
