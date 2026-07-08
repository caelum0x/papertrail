"use client";

import { useCallback, useState } from "react";
import type { SsoConnection } from "@/lib/sso/types";
import { updateConnection } from "@/components/sso/api";
import { ConfigFieldGroup } from "@/components/sso/ConfigFieldGroup";

// "Configuration" tab of the connection detail: edit the connection name and
// provider config. Secret fields are pre-masked by the API; leaving them blank
// keeps the current value (the API merges partial config).

interface ConfigPanelProps {
  connection: SsoConnection;
  onUpdated: (next: SsoConnection) => void;
}

export function ConfigPanel({ connection, onUpdated }: ConfigPanelProps) {
  const [name, setName] = useState(connection.name);
  // Start from the (masked) config so non-secret fields are editable in place.
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(connection.config)) {
      out[k] = typeof v === "string" ? v : "";
    }
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onConfigChange = useCallback((key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const onSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSaved(false);
      // Only forward changed secret-safe values: drop masked placeholders so we
      // don't overwrite a stored secret with dots.
      const patchConfig: Record<string, string> = {};
      for (const [k, v] of Object.entries(config)) {
        const value = (v ?? "").trim();
        if (value && !/^•+$/.test(value)) patchConfig[k] = value;
      }
      setSaving(true);
      try {
        const next = await updateConnection(connection.id, {
          name: name.trim() || connection.name,
          config: patchConfig,
        });
        onUpdated(next);
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      } finally {
        setSaving(false);
      }
    },
    [config, name, connection.id, connection.name, onUpdated]
  );

  return (
    <form onSubmit={onSave} className="max-w-2xl space-y-6">
      <div>
        <label htmlFor="cfg-name" className="block text-xs text-ink/60">
          Connection name
        </label>
        <input
          id="cfg-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={120}
          className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        />
      </div>

      <ConfigFieldGroup
        protocol={connection.protocol}
        values={config}
        onChange={onConfigChange}
        editing
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {saved ? <p className="text-sm text-green-700">Saved.</p> : null}

      <button
        type="submit"
        disabled={saving}
        className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save configuration"}
      </button>
    </form>
  );
}
