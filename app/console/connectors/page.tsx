"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Connector } from "@/lib/connectors/types";
import type { CatalogEntryView } from "./_components/types";
import {
  fetchConnectors,
  fetchCatalog,
} from "./_components/api";
import {
  CONNECTOR_TABS,
  ModuleHeader,
  ModuleTabs,
} from "./_components/ModuleHeader";
import { Filters } from "./_components/Filters";
import { InstalledList } from "./_components/InstalledList";
import { CatalogGrid } from "./_components/CatalogGrid";
import { InstallModal } from "./_components/InstallModal";
import { Pagination } from "./_components/Pagination";
import { TableStates } from "./_components/StateBlock";
import { PAGE_SIZE } from "./_components/shared";
import { useActiveOrgRole, canEdit } from "./_components/useActiveOrgRole";

// Connectors home: the org's installed connectors (filterable, paginated) plus a
// compact catalog grid to add more without leaving the page.
export default function ConnectorsPage() {
  const router = useRouter();
  const role = useActiveOrgRole();
  const editable = canEdit(role);

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogEntryView[]>([]);
  const [installTarget, setInstallTarget] = useState<CatalogEntryView | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchConnectors(page, PAGE_SIZE, {
      provider: provider || undefined,
      status: status || undefined,
    });
    if (res.error) {
      setError(res.error);
      setConnectors([]);
      setTotal(0);
    } else {
      setConnectors(res.data ?? []);
      setTotal(res.total);
    }
    setLoading(false);
  }, [page, provider, status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const res = await fetchCatalog();
      if (res.data) setCatalog(res.data);
    })();
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onInstalled = useCallback(
    (connector: Connector) => {
      setInstallTarget(null);
      router.push(`/console/connectors/${connector.id}`);
    },
    [router]
  );

  return (
    <div>
      <ModuleHeader
        title="Integrations"
        description="Connect PaperTrail to notification channels, reference managers, identity providers, and storage."
      />
      <ModuleTabs tabs={CONNECTOR_TABS} active="/console/connectors" />

      <div className="mt-6 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-ink/80">
          Installed connectors
        </h2>
        <Filters
          provider={provider}
          status={status}
          onProviderChange={(v) => {
            setProvider(v);
            setPage(1);
          }}
          onStatusChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          disabled={loading}
        />
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-ink/10 bg-white">
        <TableStates
          loading={loading}
          error={error}
          items={connectors}
          onRetry={load}
          loadingLabel="Loading connectors…"
          emptyLabel="No connectors installed yet. Add one from the catalog below."
        >
          <InstalledList connectors={connectors} />
        </TableStates>
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

      {catalog.length > 0 ? (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-ink/80">Add a connector</h2>
          <p className="mt-1 text-sm text-ink/40">
            Choose a provider to install. You can configure it right after.
          </p>
          <div className="mt-3">
            <CatalogGrid
              entries={catalog}
              onInstall={setInstallTarget}
              canEdit={editable}
              installingProvider={null}
            />
          </div>
        </div>
      ) : null}

      {installTarget ? (
        <InstallModal
          entry={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={onInstalled}
        />
      ) : null}
    </div>
  );
}
