"use client";

import { useMemo, useState } from "react";
import type { Connector } from "@/lib/connectors/types";
import type { CatalogEntryView } from "./types";
import { ConfigForm, buildConfig } from "./ConfigForm";
import { updateConnector } from "./api";

interface ConfigPanelProps {
  connector: Connector;
  entry: CatalogEntryView | null;
  canEdit: boolean;
  onUpdated: (connector: Connector) => void;
}

// Configuration tab: edit the connector's name and provider config. Secret values
// come back redacted from the server, so their fields start blank; leaving a
// secret blank keeps the stored value untouched only when the field is optional —
// required secrets must be re-entered to change config (the server re-validates).
export function ConfigPanel({
  connector,
  entry,
  canEdit,
  onUpdated,
}: ConfigPanelProps) {
  const fields = entry?.fields ?? [];

  const initialValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const field of fields) {
      if (field.secret) continue; // never surface redacted secrets
      const v = connector.config[field.key];
      if (typeof v === "string") out[field.key] = v;
    }
    return out;
  }, [connector.config, fields]);

  const [name, setName] = useState(connector.name);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    const config = buildConfig(fields, values);
    const res = await updateConnector(connector.id, {
      name: name.trim() === "" ? undefined : name.trim(),
      // Only send config if the user actually entered something, so an
      // untouched form doesn't wipe stored secrets with an empty object.
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    if (res.error || !res.data) {
      setError(res.error ?? "Failed to save configuration.");
      setSaving(false);
      return;
    }
    onUpdated(res.data);
    setSaved(true);
    setSaving(false);
  };

  return (
    <div className="mt-4 max-w-lg rounded-lg border border-ink/10 bg-white p-5">
      <div>
        <label className="block text-xs font-medium text-ink/60">
          Connector name
        </label>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          disabled={!canEdit || saving}
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 disabled:opacity-40"
        />
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Configuration
        </h3>
        <ConfigForm
          fields={fields}
          values={values}
          onChange={onFieldChange}
          disabled={!canEdit || saving}
        />
        {fields.some((f) => f.secret) ? (
          <p className="mt-2 text-xs text-ink/40">
            Secret values are hidden. Re-enter them only to change them.
          </p>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {saved ? (
        <p className="mt-3 text-sm text-emerald-700">Configuration saved.</p>
      ) : null}

      {canEdit ? (
        <div className="mt-5 flex justify-end">
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink/40">
          Editor role required to change configuration.
        </p>
      )}
    </div>
  );
}
