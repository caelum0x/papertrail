"use client";

import { EmptyState } from "./EmptyState";
import type { TemplateDto, TemplateField } from "@/app/console/templates/api";

interface TemplatePreviewProps {
  template: TemplateDto;
}

function renderInput(field: TemplateField) {
  const base =
    "mt-1 w-full border border-ink/15 rounded px-2 py-1.5 text-sm text-ink/80 bg-white";
  switch (field.type) {
    case "textarea":
      return (
        <textarea disabled rows={3} placeholder={field.placeholder} className={base} />
      );
    case "boolean":
      return (
        <span className="mt-1 flex items-center gap-2 text-sm text-ink/60">
          <input type="checkbox" disabled /> {field.label}
        </span>
      );
    case "select":
      return (
        <select disabled className={base}>
          {(field.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case "number":
      return (
        <input type="number" disabled placeholder={field.placeholder} className={base} />
      );
    default:
      return (
        <input type="text" disabled placeholder={field.placeholder} className={base} />
      );
  }
}

// A read-only render of what the template produces: the content skeleton plus a
// non-interactive rendering of each field, so users can see the shape before
// applying it.
export function TemplatePreview({ template }: TemplatePreviewProps) {
  const { fields, content } = template.body;

  if (!content && fields.length === 0) {
    return (
      <EmptyState
        title="Nothing to preview yet"
        message="Add content or fields in the editor to see a preview here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {content ? (
        <div className="bg-white border border-ink/10 rounded-lg p-5">
          <h3 className="text-sm font-medium text-ink/70">Content</h3>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-ink/70 font-mono">
            {content}
          </pre>
        </div>
      ) : null}

      {fields.length > 0 ? (
        <div className="bg-white border border-ink/10 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-medium text-ink/70">Fields</h3>
          {fields.map((field, i) => (
            <div key={`${field.key}-${i}`}>
              {field.type !== "boolean" ? (
                <label className="block text-xs text-ink/60">
                  {field.label}
                  {field.required ? (
                    <span className="text-red-500"> *</span>
                  ) : null}
                </label>
              ) : null}
              {renderInput(field)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
