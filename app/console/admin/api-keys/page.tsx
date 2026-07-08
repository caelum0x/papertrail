"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { AdminNoAccess } from "../_components/AdminNoAccess";
import { CreateKeyForm } from "../_components/CreateKeyForm";
import { NewKeyReveal } from "../_components/NewKeyReveal";
import { ApiKeysList } from "../_components/ApiKeysList";
import type {
  ApiKeySummary,
  ApiKeyCreated,
} from "../_components/apiKeyTypes";

export default function ApiKeysPage() {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const onCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setCreating(true);
      setCreateError(null);
      setNewSecret(null);
      setCopied(false);
      const res = await sendJson<ApiKeyCreated>("/api/api-keys", "POST", {
        name,
      });
      setCreating(false);
      if (!res.success || !res.data) {
        setCreateError(res.error ?? "Failed to create API key.");
        return;
      }
      setNewSecret(res.data.key);
      setName("");
      load();
    },
    [name, load]
  );

  const onRevoke = useCallback(async (id: string) => {
    const res = await sendJson<ApiKeySummary>(`/api/api-keys/${id}`, "DELETE");
    if (res.success && res.data) {
      setKeys((prev) => prev.map((k) => (k.id === id ? res.data! : k)));
    }
  }, []);

  const onCopy = useCallback(async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [newSecret]);

  if (!roleLoading && !canManage) {
    return (
      <AdminNoAccess
        title="API keys"
        message="You need an admin or owner role to manage API keys."
      />
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink/80">API keys</h1>
      <p className="mt-1 text-sm text-ink/40">
        Programmatic access keys for this organization. Keep them secret.
      </p>

      <CreateKeyForm
        name={name}
        creating={creating}
        error={createError}
        onNameChange={setName}
        onSubmit={onCreate}
      />

      {newSecret ? (
        <NewKeyReveal
          secret={newSecret}
          copied={copied}
          onCopy={onCopy}
          onDismiss={() => setNewSecret(null)}
        />
      ) : null}

      <ApiKeysList
        keys={keys}
        loading={loading}
        error={error}
        onRevoke={onRevoke}
      />
    </div>
  );
}
