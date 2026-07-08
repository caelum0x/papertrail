"use client";

import { useCallback, useState } from "react";
import type { ProviderCatalogEntry } from "./types";
import { ProviderField } from "./ProviderField";

interface InstallModalProps {
  provider: ProviderCatalogEntry;
  onClose: () => void;
  onInstall: (
    provider: ProviderCatalogEntry,
    name: string,
    config: Record<string, string>
  ) => Promise<{ ok: boolean; error?: string }>;
}

// Modal that collects a name + the provider's config fields and installs the
// connector. Owns its own form state; the actual POST is delegated to the
// parent-provided onInstall so all pages share one code path.
export function InstallModal({ provider, onClose, onInstall }: InstallModalProps) {
  const [name, setName] = useState(provider.name);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setFormError(null);
      // Only forward non-empty fields so optional keys don't fail validation.
      const config: Record<string, string> = {};
      for (const field of provider.fields) {
        const value = form[field.key]?.trim();
        if (value) config[field.key] = value;
      }
      const res = await onInstall(provider, name, config);
      setSaving(false);
      if (!res.ok) {
        setFormError(res.error ?? "Failed to install integration.");
        return;
      }
      onClose();
    },
    [provider, form, name, onInstall, onClose]
  );

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-white border border-ink/15 rounded-lg p-5"
      >
        <h3 className="text-sm font-medium text-ink/80">
          Install {provider.name}
        </h3>
        <p className="mt-1 text-xs text-ink/40">{provider.description}</p>

        <label className="mt-4 block text-xs text-ink/60">Name</label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
          aria-label="Integration name"
        />

        {provider.fields.map((field) => (
          <ProviderField
            key={field.key}
            field={field}
            value={form[field.key] ?? ""}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, [field.key]: value }))
            }
          />
        ))}

        {formError ? (
          <p className="mt-3 text-sm text-red-600">{formError}</p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink/60 hover:text-ink/80"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
          >
            {saving ? "Installing..." : "Install"}
          </button>
        </div>
      </form>
    </div>
  );
}
