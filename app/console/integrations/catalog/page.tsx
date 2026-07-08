"use client";

import { useState } from "react";
import { IntegrationsHeader } from "../_components/IntegrationsHeader";
import { CatalogGrid } from "../_components/CatalogGrid";
import { InstallModal } from "../_components/InstallModal";
import { useIntegrations } from "../_components/useIntegrations";
import type { ProviderCatalogEntry } from "../_components/types";

// Dedicated integrations catalog sub-page: browse every available provider and
// install one, on its own route for direct linking. Reuses the shared
// useIntegrations hook and the existing /api/integrations endpoints.
export default function IntegrationsCatalogPage() {
  const {
    canManage,
    roleLoading,
    installed,
    catalog,
    loading,
    error,
    install,
  } = useIntegrations();

  const [installing, setInstalling] = useState<ProviderCatalogEntry | null>(null);

  if (!roleLoading && !canManage) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Integrations catalog</h1>
        <p className="mt-4 text-sm text-ink/60">
          You need an admin or owner role to install integrations.
        </p>
      </div>
    );
  }

  const installedProviders = new Set(installed.map((i) => i.provider));

  return (
    <div>
      <IntegrationsHeader
        title="Integrations catalog"
        subtitle="Every provider PaperTrail can connect to. Install one to route flags, alerts, and references into your existing tools."
        link={{ href: "/console/integrations", label: "← Integrations" }}
      />

      <div className="mt-6">
        {loading ? (
          <div className="bg-white border border-ink/10 rounded-lg p-5 text-sm text-ink/40">
            Loading catalog...
          </div>
        ) : error ? (
          <div className="bg-white border border-ink/10 rounded-lg p-5 text-sm text-red-600">
            {error}
          </div>
        ) : catalog.length === 0 ? (
          <div className="bg-white border border-ink/10 rounded-lg p-5 text-sm text-ink/40">
            No integrations are available.
          </div>
        ) : (
          <CatalogGrid
            catalog={catalog}
            installedProviders={installedProviders}
            onInstall={setInstalling}
          />
        )}
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
