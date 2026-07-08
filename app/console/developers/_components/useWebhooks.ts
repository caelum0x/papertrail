"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import {
  AVAILABLE_EVENTS,
  type WebhookCreated,
  type WebhookSummary,
} from "./webhookTypes";

interface WebhooksState {
  canManage: boolean;
  roleLoading: boolean;
  hooks: WebhookSummary[];
  loading: boolean;
  error: string | null;
  creating: boolean;
  createError: string | null;
  newSecret: string | null;
  testResult: Record<string, string>;
  create: (url: string, events: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggleStatus: (hook: WebhookSummary) => Promise<void>;
  test: (id: string) => Promise<void>;
  dismissSecret: () => void;
}

// Loads and mutates the org's webhooks against the existing /api/webhooks
// endpoints, gated on the admin+ role. Owns list, create, test, toggle, and
// delete behavior so the webhooks page stays declarative.
export function useWebhooks(): WebhooksState {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [hooks, setHooks] = useState<WebhookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<WebhookSummary[]>("/api/webhooks?limit=100");
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load webhooks.");
      setLoading(false);
      return;
    }
    setHooks(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  const create = useCallback(
    async (url: string, events: string[]) => {
      setCreating(true);
      setCreateError(null);
      setNewSecret(null);
      if (events.length === 0) {
        setCreating(false);
        setCreateError("Select at least one event.");
        return;
      }
      const res = await sendJson<WebhookCreated>("/api/webhooks", "POST", {
        url,
        events,
      });
      setCreating(false);
      if (!res.success || !res.data) {
        setCreateError(res.error ?? "Failed to create webhook.");
        return;
      }
      setNewSecret(res.data.secret);
      load();
    },
    [load]
  );

  const remove = useCallback(async (id: string) => {
    const res = await sendJson<WebhookSummary>(`/api/webhooks/${id}`, "DELETE");
    if (res.success) {
      setHooks((prev) => prev.filter((h) => h.id !== id));
    }
  }, []);

  const toggleStatus = useCallback(async (hook: WebhookSummary) => {
    const next = hook.status === "active" ? "disabled" : "active";
    const res = await sendJson<WebhookSummary>(`/api/webhooks/${hook.id}`, "PATCH", {
      status: next,
    });
    if (res.success && res.data) {
      setHooks((prev) => prev.map((h) => (h.id === hook.id ? res.data! : h)));
    }
  }, []);

  const test = useCallback(async (id: string) => {
    setTestResult((prev) => ({ ...prev, [id]: "Sending…" }));
    const res = await sendJson<{ ok: boolean; responseCode: number | null }>(
      `/api/webhooks/${id}/test`,
      "POST"
    );
    if (res.success && res.data) {
      const { ok, responseCode } = res.data;
      setTestResult((prev) => ({
        ...prev,
        [id]: ok
          ? `Delivered (${responseCode})`
          : `Failed${responseCode ? ` (${responseCode})` : " — no response"}`,
      }));
    } else {
      setTestResult((prev) => ({ ...prev, [id]: res.error ?? "Test failed." }));
    }
  }, []);

  const dismissSecret = useCallback(() => setNewSecret(null), []);

  return {
    canManage,
    roleLoading,
    hooks,
    loading,
    error,
    creating,
    createError,
    newSecret,
    testResult,
    create,
    remove,
    toggleStatus,
    test,
    dismissSecret,
  };
}

export { AVAILABLE_EVENTS };
