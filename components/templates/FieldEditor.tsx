"use client";

import {
  TEMPLATE_FIELD_TYPES,
  type TemplateField,
  type TemplateFieldType,
} from "@/app/console/templates/api";

interface FieldEditorProps {
  fields: TemplateField[];
  onChange: (fields: TemplateField[]) => void;
}

function blankField(): TemplateField {
  return { key: "", label: "", type: "text", required: false };
}

// Editor for the ordered list of template fields. Immutable updates only — every
// mutation returns a new array/objects so parent state stays predictable.
export function FieldEditor({ fields, onChange }: FieldEditorProps) {
  const update = (index: number, patch: Partial<TemplateField>) => {
    onChange(
      fields.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const remove = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...fields, blankField()]);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink/70">Fields</h3>
        <button
          type="button"
          onClick={add}
          className="text-sm text-accent"
        >
          + Add field
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-ink/40">
          No fields yet. Add fields to describe the template&apos;s inputs.
        </p>
      ) : (
        <ul className="space-y-3">
          {fields.map((field, index) => (
            <li
              key={index}
              className="border border-ink/10 rounded-lg p-3 bg-paper"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-ink/60">
                  Key
                  <input
                    value={field.key}
                    onChange={(e) => update(index, { key: e.target.value })}
                    placeholder="e.g. drug_name"
                    className="mt-1 w-full border border-ink/15 rounded px-2 py-1.5 text-sm text-ink/80 bg-white"
                  />
                </label>
                <label className="text-xs text-ink/60">
                  Label
                  <input
                    value={field.label}
                    onChange={(e) => update(index, { label: e.target.value })}
                    placeholder="e.g. Drug name"
                    className="mt-1 w-full border border-ink/15 rounded px-2 py-1.5 text-sm text-ink/80 bg-white"
                  />
                </label>
                <label className="text-xs text-ink/60">
                  Type
                  <select
                    value={field.type}
                    onChange={(e) =>
                      update(index, {
                        type: e.target.value as TemplateFieldType,
                      })
                    }
                    className="mt-1 w-full border border-ink/15 rounded px-2 py-1.5 text-sm text-ink/80 bg-white"
                  >
                    {TEMPLATE_FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink/60">
                  Placeholder
                  <input
                    value={field.placeholder ?? ""}
                    onChange={(e) =>
                      update(index, {
                        placeholder: e.target.value || undefined,
                      })
                    }
                    className="mt-1 w-full border border-ink/15 rounded px-2 py-1.5 text-sm text-ink/80 bg-white"
                  />
                </label>
              </div>

              {field.type === "select" ? (
                <label className="mt-2 block text-xs text-ink/60">
                  Options (comma-separated)
                  <input
                    value={(field.options ?? []).join(", ")}
                    onChange={(e) =>
                      update(index, {
                        options: e.target.value
                          .split(",")
                          .map((o) => o.trim())
                          .filter(Boolean),
                      })
                    }
                    className="mt-1 w-full border border-ink/15 rounded px-2 py-1.5 text-sm text-ink/80 bg-white"
                  />
                </label>
              ) : null}

              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-ink/60">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) =>
                      update(index, { required: e.target.checked })
                    }
                  />
                  Required
                </label>
                <div className="flex items-center gap-3 text-xs text-ink/50">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="disabled:opacity-30"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === fields.length - 1}
                    className="disabled:opacity-30"
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="text-red-600"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
