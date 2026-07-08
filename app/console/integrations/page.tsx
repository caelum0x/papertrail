"use client";

import { useState } from "react";
import { IntegrationsHeader } from "./_components/IntegrationsHeader";
import { InstalledList } from "./_components/InstalledList";
import { CatalogGrid } from "./_components/CatalogGrid";
import { InstallModal } from "./_components/InstallModal";
import { useIntegrations } from "./_components/useIntegrations";
import type { ProviderCatalogEntry } from "./_components/types";

// Integrations home: the org's installed connectors plus a catalog of available
// providers to install. Admin+ only (enforced client-side for UX and
// server-side by the API).
export default function IntegrationsPage() {
  const {
    canManage,
    roleLoading,
    installed,
    catalog,
    loading,
    error,
    install,
    toggleStatus,
    remove,
  } = useIntegrations();

  const [installing, setInstalling] = useState<ProviderCatalogEntry | null>(null);

  if (!roleLoading && !canManage) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Integrations</h1>
        <p className="mt-4 text-sm text-ink/60">
          You need an admin or owner role to manage integrations.
        </p>
      </div>
    );
  }

  const installedProviders = new Set(installed.map((i) => i.provider));

  return (
    <div>
      <IntegrationsHeader
        title="Integrations"
        subtitle="Connect PaperTrail to the systems your lab already uses — post flags to Slack, email alerts, sync references to Zotero, or import claims from CSV."
      />

      <InstalledList
        installed={installed}
        loading={loading}
        error={error}
        onToggleStatus={toggleStatus}
        onDelete={remove}
      />

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ink/80">
          Available integrations
        </h2>
        <CatalogGrid
          catalog={catalog}
          installedProviders={installedProviders}
          onInstall={setInstalling}
        />
      </div>

      {installing ? (
        <InstallModal
          provider={installing}
          onClose={() => setInstalling(null)}
          onInstall={install}
        />
      ) : null}
    </div>
  );
}
