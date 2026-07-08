"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import type {
  Integration,
  IntegrationEvent,
  ProviderCatalogEntry,
  TestResult,
} from "./types";

interface IntegrationDetailState {
  canManage: boolean;
  roleLoading: boolean;
  integration: Integration | null;
  provider: ProviderCatalogEntry | null;
  events: IntegrationEvent[];
  loading: boolean;
  error: string | null;
  // Form state
  name: string;
  setName: (name: string) => void;
  form: Record<string, string>;
  setField: (key: string, value: string) => void;
  saving: boolean;
  saveError: string | null;
  saved: boolean;
  test: TestResult | null;
  testing: boolean;
  save: () => Promise<void>;
  toggleStatus: () => Promise<void>;
  sendTest: () => Promise<void>;
}

// Loads one integration, its provider definition, and its recent event log from
// the existing /api/integrations/[id] endpoints, and owns the config-form,
// save, status-toggle, and test-event behavior. Admin+ gated.
export function useIntegrationDetail(id: string | undefined): IntegrationDetailState {
  const { canManage, loading: roleLoading } = useCurrentRole();

  const [integration, setIntegration] = useState<Integration | null>(null);
  const [provider, setProvider] = useState<ProviderCatalogEntry | null>(null);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [int, cat, ev] = await Promise.all([
      getJson<Integration>(`/api/integrations/${id}`),
      getJson<ProviderCatalogEntry[]>("/api/integrations/providers"),
      getJson<IntegrationEvent[]>(`/api/integrations/${id}/events?limit=50`),
    ]);
    if (!int.success || !int.data) {
      setError(int.error ?? "Failed to load integration.");
      setLoading(false);
      return;
    }
    setIntegration(int.data);
    setName(int.data.name);
    const def =
      cat.success && cat.data
        ? cat.data.find((p) => p.id === int.data!.provider) ?? null
        : null;
    setProvider(def);
    // Prefill non-secret config values; secrets show masked placeholders only.
    const prefill: Record<string, string> = {};
    if (def) {
      for (const field of def.fields) {
        if (!field.secret) {
          const value = int.data.config[field.key];
          if (typeof value === "string") prefill[field.key] = value;
        }
      }
    }
    setForm(prefill);
    setEvents(ev.success && ev.data ? ev.data : []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  const setField = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    if (!id || !provider) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    // Build config from all provider fields. For secret fields, only include a
    // value if the user actually typed a new one (blank = keep existing).
    const config: Record<string, string> = {};
    for (const field of provider.fields) {
      const value = form[field.key]?.trim();
      if (value) config[field.key] = value;
    }
    // If a required secret is left blank, omit config so the stored secret is
    // preserved and only the name is updated.
    const secretsMissing = provider.fields.some(
      (f) => f.secret && f.required && !form[f.key]?.trim()
    );
    const payload: Record<string, unknown> = { name: name.trim() };
    if (!secretsMissing) {
      payload.config = config;
    }

    const res = await sendJson<Integration>(
      `/api/integrations/${id}`,
      "PATCH",
      payload
    );
    setSaving(false);
    if (!res.success || !res.data) {
      setSaveError(res.error ?? "Failed to save.");
      return;
    }
    setIntegration(res.data);
    setSaved(true);
  }, [id, provider, form, name]);

  const toggleStatus = useCallback(async () => {
    if (!id || !integration) return;
    const next = integration.status === "active" ? "disabled" : "active";
    const res = await sendJson<Integration>(`/api/integrations/${id}`, "PATCH", {
      status: next,
    });
    if (res.success && res.data) setIntegration(res.data);
  }, [id, integration]);

  const sendTest = useCallback(async () => {
    if (!id) return;
    setTesting(true);
    setTest(null);
    const res = await sendJson<TestResult>(`/api/integrations/${id}/test`, "POST");
    setTesting(false);
    if (res.success && res.data) {
      setTest(res.data);
      // Refresh the event log to show the just-recorded test.
      const ev = await getJson<IntegrationEvent[]>(
        `/api/integrations/${id}/events?limit=50`
      );
      if (ev.success && ev.data) setEvents(ev.data);
    } else {
      setTest({
        ok: false,
        detail: res.error ?? "Test failed.",
        responseCode: null,
      });
    }
  }, [id]);

  return {
    canManage,
    roleLoading,
    integration,
    provider,
    events,
    loading,
    error,
    name,
    setName,
    form,
    setField,
    saving,
    saveError,
    saved,
    test,
    testing,
    save,
    toggleStatus,
    sendTest,
  };
}
