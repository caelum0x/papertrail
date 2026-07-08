"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Connector } from "@/lib/connectors/types";
import type { CatalogEntryView } from "../_components/types";
import {
  connectConnector,
  deleteConnector,
  fetchCatalog,
  fetchConnector,
  syncConnector,
  testConnector,
} from "../_components/api";
import { ConnectorHeader } from "../_components/ConnectorHeader";
import { Tabs, type DetailTab } from "../_components/Tabs";
import { ConfigPanel } from "../_components/ConfigPanel";
import { SyncPanel } from "../_components/SyncPanel";
import { EventsPanel } from "../_components/EventsPanel";
import {
  ErrorState,
  LoadingState,
} from "../_components/StateBlock";
import { useActiveOrgRole, canEdit } from "../_components/useActiveOrgRole";

// Connector detail: header (identity + lifecycle actions) and tabbed panels for
// configuration, sync history, and events.
export default function ConnectorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const role = useActiveOrgRole();
  const editable = canEdit(role);

  const [connector, setConnector] = useState<Connector | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<DetailTab>("config");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bumped to force the sync/event panels to reload after an action.
  const [syncRefresh, setSyncRefresh] = useState(0);
  const [eventRefresh, setEventRefresh] = useState(0);

  const entry = useMemo(
    () => catalog.find((e) => e.provider === connector?.provider) ?? null,
    [catalog, connector]
  );

  const loadConnector = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await fetchConnector(id);
    if (res.error || !res.data) {
      setError(res.error ?? "Connector not found.");
      setConnector(null);
    } else {
      setConnector(res.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadConnector();
  }, [loadConnector]);

  useEffect(() => {
    (async () => {
      const res = await fetchCatalog();
      if (res.data) setCatalog(res.data);
    })();
  }, []);

  const onConnect = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const res = await connectConnector(id);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Failed to connect.");
    } else {
      setNotice(res.data.message);
      await loadConnector();
      setEventRefresh((n) => n + 1);
    }
    setBusy(false);
  }, [id, loadConnector]);

  const onSync = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const res = await syncConnector(id);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Failed to run sync.");
    } else {
      setNotice(
        res.data.status === "success"
          ? `Sync complete — ${res.data.items} item(s).`
          : "Sync finished with errors."
      );
      await loadConnector();
      setSyncRefresh((n) => n + 1);
      setEventRefresh((n) => n + 1);
      setTab("syncs");
    }
    setBusy(false);
  }, [id, loadConnector]);

  const onTest = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const res = await testConnector(id);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Failed to send test event.");
    } else {
      setNotice(res.data.message);
      setEventRefresh((n) => n + 1);
      setTab("events");
    }
    setBusy(false);
  }, [id]);

  const onDelete = useCallback(async () => {
    if (!id) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this connector? Its syncs and events are removed too.")
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    const res = await deleteConnector(id);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Failed to delete connector.");
      setBusy(false);
      return;
    }
    router.push("/console/connectors");
  }, [id, router]);

  if (loading) {
    return <LoadingState label="Loading connector…" />;
  }
  if (error || !connector) {
    return (
      <div>
        <ErrorState
          message={error ?? "Connector not found."}
          onRetry={loadConnector}
        />
        <div className="mt-4">
          <Link
            href="/console/connectors"
            className="text-sm text-accent hover:underline"
          >
            ← Back to connectors
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ConnectorHeader
        connector={connector}
        entry={entry}
        canEdit={editable}
        busy={busy}
        onConnect={onConnect}
        onSync={onSync}
        onTest={onTest}
        onDelete={onDelete}
      />

      {notice ? (
        <p className="mt-3 text-sm text-emerald-700">{notice}</p>
      ) : null}
      {actionError ? (
        <p className="mt-3 text-sm text-red-700">{actionError}</p>
      ) : null}

      <Tabs active={tab} onChange={setTab} />

      {tab === "config" ? (
        <ConfigPanel
          connector={connector}
          entry={entry}
          canEdit={editable}
          onUpdated={setConnector}
        />
      ) : tab === "syncs" ? (
        <SyncPanel connectorId={connector.id} refreshKey={syncRefresh} />
      ) : (
        <EventsPanel connectorId={connector.id} refreshKey={eventRefresh} />
      )}
    </div>
  );
}
