"use client";

import type { CatalogField } from "./types";

interface ConfigFormProps {
  fields: CatalogField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

// Renders a provider's config fields from the catalog descriptors. Values are
// held as strings by the parent and coerced/validated server-side against the
// provider's Zod schema. Secret fields render as password inputs.
export function ConfigForm({
  fields,
  values,
  onChange,
  disabled,
}: ConfigFormProps) {
  if (fields.length === 0) {
    return (
      <p className="text-sm text-ink/40">
        This provider needs no configuration.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-xs font-medium text-ink/60">
            {field.label}
            {field.required ? <span className="text-accent"> *</span> : null}
          </label>
          {field.type === "select" ? (
            <select
              value={values[field.key] ?? ""}
              onChange={(e) => onChange(field.key, e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 disabled:opacity-40"
            >
              <option value="">Select…</option>
              {(field.options ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={
                field.type === "password"
                  ? "password"
                  : field.type === "email"
                    ? "email"
                    : field.type === "url"
                      ? "url"
                      : "text"
              }
              value={values[field.key] ?? ""}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              disabled={disabled}
              autoComplete={field.secret ? "off" : undefined}
              className="mt-1 w-full rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 disabled:opacity-40"
            />
          )}
          {field.help ? (
            <p className="mt-1 text-xs text-ink/40">{field.help}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// Coerces the string-keyed form values into a config object, dropping empty
// optional values so they aren't sent as empty strings the schema would reject.
export function buildConfig(
  fields: CatalogField[],
  values: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined || raw.trim() === "") continue;
    out[field.key] = raw.trim();
  }
  return out;
}
