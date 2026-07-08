import type { SchemaProperty } from "./types";

interface TryItFieldProps {
  name: string;
  prop: SchemaProperty;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
}

// Renders a single input for the try-it form, derived from one JSON-schema
// property: a <select> for enums, a number input, or a textarea otherwise.
export function TryItField({ name, prop, required, value, onChange }: TryItFieldProps) {
  return (
    <div className="mt-3">
      <label className="block text-xs text-ink/60 font-mono">
        {name}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      {prop.enum ? (
        <select
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent bg-white"
        >
          <option value="">Select…</option>
          {prop.enum.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : prop.type === "number" ? (
        <input
          type="number"
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        />
      ) : (
        <textarea
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        />
      )}
      {prop.description ? (
        <p className="mt-1 text-xs text-ink/40">{prop.description}</p>
      ) : null}
    </div>
  );
}
