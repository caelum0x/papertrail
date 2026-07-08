"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Connector } from "@/lib/connectors/types";
import type { CatalogEntryView } from "../_components/types";
import { fetchCatalog } from "../_components/api";
import {
  CONNECTOR_TABS,
  ModuleHeader,
  ModuleTabs,
} from "../_components/ModuleHeader";
import { CatalogGrid } from "../_components/CatalogGrid";
import { InstallModal } from "../_components/InstallModal";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../_components/StateBlock";
import { useActiveOrgRole, canEdit } from "../_components/useActiveOrgRole";

// Full provider catalog grid. Selecting a provider opens the install modal.
export default function ConnectorCatalogPage() {
  const router = useRouter();
  const role = useActiveOrgRole();
  const editable = canEdit(role);

  const [entries, setEntries] = useState<CatalogEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<CatalogEntryView | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchCatalog();
    if (res.error) {
      setError(res.error);
      setEntries([]);
    } else {
      setEntries(res.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
        title="Connector catalog"
        description="Browse every provider PaperTrail can connect to and install the ones your lab needs."
      />
      <ModuleTabs tabs={CONNECTOR_TABS} active="/console/connectors/catalog" />

      <div className="mt-6">
        {loading ? (
          <div className="rounded-lg border border-ink/10 bg-white">
            <LoadingState label="Loading catalog…" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-ink/10 bg-white">
            <ErrorState message={error} onRetry={load} />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-ink/10 bg-white">
            <EmptyState>No providers available.</EmptyState>
          </div>
        ) : (
          <CatalogGrid
            entries={entries}
            onInstall={setInstallTarget}
            canEdit={editable}
            installingProvider={null}
          />
        )}
      </div>

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
