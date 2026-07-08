"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import type { ApiKeyCreated, ApiKeySummary } from "./types";

interface ApiKeysState {
  canManage: boolean;
  roleLoading: boolean;
  keys: ApiKeySummary[];
  loading: boolean;
  error: string | null;
  creating: boolean;
  createError: string | null;
  newSecret: string | null;
  create: (name: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
  dismissSecret: () => void;
}

// Loads and mutates the org's API keys against the existing /api/api-keys
// endpoints, gated on the admin+ role. Shared by the developer portal home and
// the dedicated keys sub-page so their behavior stays identical.
export function useApiKeys(): ApiKeysState {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<ApiKeySummary[]>("/api/api-keys?limit=100");
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load API keys.");
      setLoading(false);
      return;
    }
    setKeys(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  const create = useCallback(
    async (name: string) => {
      setCreating(true);
      setCreateError(null);
      setNewSecret(null);
      const res = await sendJson<ApiKeyCreated>("/api/api-keys", "POST", { name });
      setCreating(false);
      if (!res.success || !res.data) {
        setCreateError(res.error ?? "Failed to create API key.");
        return;
      }
      setNewSecret(res.data.key);
      load();
    },
    [load]
  );

  const revoke = useCallback(async (id: string) => {
    const res = await sendJson<ApiKeySummary>(`/api/api-keys/${id}`, "DELETE");
    if (res.success && res.data) {
      setKeys((prev) => prev.map((k) => (k.id === id ? res.data! : k)));
    }
  }, []);

  const dismissSecret = useCallback(() => setNewSecret(null), []);

  return {
    canManage,
    roleLoading,
    keys,
    loading,
    error,
    creating,
    createError,
    newSecret,
    create,
    revoke,
    dismissSecret,
  };
}
