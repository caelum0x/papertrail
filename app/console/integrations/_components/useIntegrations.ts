"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import type { Integration, ProviderCatalogEntry } from "./types";

interface IntegrationsState {
  canManage: boolean;
  roleLoading: boolean;
  installed: Integration[];
  catalog: ProviderCatalogEntry[];
  loading: boolean;
  error: string | null;
  install: (
    provider: ProviderCatalogEntry,
    name: string,
    config: Record<string, string>
  ) => Promise<{ ok: boolean; error?: string }>;
  toggleStatus: (integration: Integration) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// Loads and mutates the org's installed integrations and the provider catalog
// against the existing /api/integrations endpoints, gated on the admin+ role.
// Shared by the integrations home and the catalog sub-page.
export function useIntegrations(): IntegrationsState {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [installed, setInstalled] = useState<Integration[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [inst, cat] = await Promise.all([
      getJson<Integration[]>("/api/integrations?limit=100"),
      getJson<ProviderCatalogEntry[]>("/api/integrations/providers"),
    ]);
    if (!inst.success || !inst.data) {
      setError(inst.error ?? "Failed to load integrations.");
      setLoading(false);
      return;
    }
    setInstalled(inst.data);
    setCatalog(cat.success && cat.data ? cat.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  const install = useCallback(
    async (
      provider: ProviderCatalogEntry,
      name: string,
      config: Record<string, string>
    ) => {
      const res = await sendJson<Integration>("/api/integrations", "POST", {
        provider: provider.id,
        name: name.trim() || provider.name,
        config,
      });
      if (!res.success || !res.data) {
        return { ok: false, error: res.error ?? "Failed to install integration." };
      }
      load();
      return { ok: true };
    },
    [load]
  );

  const toggleStatus = useCallback(async (integration: Integration) => {
    const next = integration.status === "active" ? "disabled" : "active";
    const res = await sendJson<Integration>(
      `/api/integrations/${integration.id}`,
      "PATCH",
      { status: next }
    );
    if (res.success && res.data) {
      setInstalled((prev) =>
        prev.map((i) => (i.id === integration.id ? res.data! : i))
      );
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await sendJson<Integration>(`/api/integrations/${id}`, "DELETE");
    if (res.success) {
      setInstalled((prev) => prev.filter((i) => i.id !== id));
    }
  }, []);

  return {
    canManage,
    roleLoading,
    installed,
    catalog,
    loading,
    error,
    install,
    toggleStatus,
    remove,
  };
}
