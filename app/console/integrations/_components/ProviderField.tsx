import { inputTypeFor, type ProviderField as ProviderFieldDef } from "./types";

interface ProviderFieldProps {
  field: ProviderFieldDef;
  value: string;
  onChange: (value: string) => void;
  // Placeholder override (e.g. the masked stored secret on the detail page).
  placeholder?: string;
  // Whether to honor the field's `required` flag (install form does; the detail
  // form leaves secrets optional so they can be left blank to keep the stored one).
  enforceRequired?: boolean;
  // Custom help node rendered under the input, overriding field.help.
  help?: React.ReactNode;
}

// A single labelled config input rendered from a provider field definition —
// textarea or typed input. Shared by the install modal and the detail form.
export function ProviderField({
  field,
  value,
  onChange,
  placeholder,
  enforceRequired = true,
  help,
}: ProviderFieldProps) {
  const required = enforceRequired && field.required;
  return (
    <div className="mt-3">
      <label className="block text-xs text-ink/60">
        {field.label}
        {field.required ? <span className="text-red-600"> *</span> : null}
      </label>
      {field.type === "textarea" ? (
        <textarea
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? field.placeholder}
          rows={3}
          className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        />
      ) : (
        <input
          type={inputTypeFor(field.type)}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? field.placeholder}
          maxLength={2048}
          className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        />
      )}
      {help ?? (field.help ? (
        <p className="mt-1 text-xs text-ink/40">{field.help}</p>
      ) : null)}
    </div>
  );
}
