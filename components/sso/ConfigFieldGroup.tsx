"use client";

import type { SsoProtocol } from "@/lib/sso/types";
import { fieldsForProtocol } from "@/components/sso/fields";

// Renders the provider-specific config inputs for a protocol as a field group.
// Controlled: the parent owns the values map and receives changes. Reused by the
// new-connection wizard and the detail edit panel.

interface ConfigFieldGroupProps {
  protocol: SsoProtocol;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  // When true, secret fields show a "leave blank to keep current" hint (edit).
  editing?: boolean;
}

export function ConfigFieldGroup({
  protocol,
  values,
  onChange,
  editing = false,
}: ConfigFieldGroupProps) {
  const fields = fieldsForProtocol(protocol);
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.key}>
          <label
            htmlFor={`sso-${field.key}`}
            className="block text-xs text-ink/60"
          >
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </label>
          {field.type === "textarea" ? (
            <textarea
              id={`sso-${field.key}`}
              rows={4}
              required={field.required && !editing}
              value={values[field.key] ?? ""}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="mt-1 w-full text-sm font-mono border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
            />
          ) : (
            <input
              id={`sso-${field.key}`}
              type={field.type === "url" ? "url" : "text"}
              required={field.required && !editing}
              value={values[field.key] ?? ""}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              maxLength={4096}
              autoComplete="off"
              className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
            />
          )}
          {field.help ? (
            <p className="mt-1 text-xs text-ink/40">{field.help}</p>
          ) : null}
          {field.secret && editing ? (
            <p className="mt-1 text-xs text-ink/40">
              Leave blank to keep the current value.
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
