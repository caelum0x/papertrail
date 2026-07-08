"use client";

import type { Integration, ProviderCatalogEntry, TestResult } from "./types";
import { ProviderField } from "./ProviderField";

interface IntegrationConfigFormProps {
  integration: Integration;
  provider: ProviderCatalogEntry | null;
  name: string;
  onNameChange: (name: string) => void;
  form: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  saving: boolean;
  saveError: string | null;
  saved: boolean;
  testing: boolean;
  test: TestResult | null;
  onSave: () => void;
  onTest: () => void;
  onToggleStatus: () => void;
}

// The integration's configuration form: name, provider config fields (secrets
// masked, blank to keep), and the save / test / enable-disable actions plus the
// inline test result.
export function IntegrationConfigForm({
  integration,
  provider,
  name,
  onNameChange,
  form,
  onFieldChange,
  saving,
  saveError,
  saved,
  testing,
  test,
  onSave,
  onTest,
  onToggleStatus,
}: IntegrationConfigFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5"
    >
      <h2 className="text-sm font-medium text-ink/70">Configuration</h2>

      <label className="mt-3 block text-xs text-ink/60">Name</label>
      <input
        type="text"
        required
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        maxLength={120}
        className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        aria-label="Integration name"
      />

      {provider?.fields.map((field) => {
        const masked =
          field.secret && typeof integration.config[field.key] === "string"
            ? (integration.config[field.key] as string)
            : null;
        return (
          <ProviderField
            key={field.key}
            field={field}
            value={form[field.key] ?? ""}
            onChange={(value) => onFieldChange(field.key, value)}
            placeholder={masked ?? field.placeholder}
            // Secrets are optional here: blank keeps the stored value.
            enforceRequired={false}
            help={
              field.secret && masked ? (
                <p className="mt-1 text-xs text-ink/40">
                  Stored (<code>{masked}</code>). Leave blank to keep it.
                </p>
              ) : undefined
            }
          />
        );
      })}

      {saveError ? <p className="mt-3 text-sm text-red-600">{saveError}</p> : null}
      {saved ? <p className="mt-3 text-sm text-ink/60">Saved.</p> : null}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="text-sm border border-ink/15 rounded px-4 py-2 hover:border-accent disabled:opacity-50"
        >
          {testing ? "Testing..." : "Send test event"}
        </button>
        <button
          type="button"
          onClick={onToggleStatus}
          className="text-sm text-ink/60 hover:text-accent ml-auto"
        >
          {integration.status === "active" ? "Disable" : "Enable"}
        </button>
      </div>

      {test ? (
        <div
          className={`mt-4 text-sm rounded px-3 py-2 ${
            test.ok ? "bg-paper text-ink/70" : "bg-paper text-red-600"
          }`}
        >
          {test.detail}
          {test.responseCode !== null ? ` (HTTP ${test.responseCode})` : ""}
        </div>
      ) : null}
    </form>
  );
}
