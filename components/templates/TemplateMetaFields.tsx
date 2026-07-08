"use client";

import {
  KIND_LABELS,
  TEMPLATE_KINDS,
  type TemplateKind,
} from "@/app/console/templates/api";

interface TemplateMetaFieldsProps {
  kind: TemplateKind;
  name: string;
  description: string;
  category: string;
  kindLocked?: boolean;
  onKindChange: (kind: TemplateKind) => void;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onCategoryChange: (category: string) => void;
}

// The metadata field group for a template form: kind, name, description,
// category. Split out so the create form and the editor can reuse it. When
// kindLocked is set (editing an existing template) the kind selector is disabled
// because kind is immutable server-side.
export function TemplateMetaFields({
  kind,
  name,
  description,
  category,
  kindLocked,
  onKindChange,
  onNameChange,
  onDescriptionChange,
  onCategoryChange,
}: TemplateMetaFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-sm text-ink/70">
          Kind
          <select
            value={kind}
            disabled={kindLocked}
            onChange={(e) => onKindChange(e.target.value as TemplateKind)}
            className="mt-1 w-full border border-ink/15 rounded px-2 py-2 text-sm text-ink/80 bg-white disabled:opacity-60"
          >
            {TEMPLATE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {kindLocked ? (
            <span className="mt-1 block text-xs text-ink/40">
              Kind can&apos;t be changed after creation.
            </span>
          ) : null}
        </label>

        <label className="text-sm text-ink/70">
          Category
          <input
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            placeholder="e.g. Oncology"
            className="mt-1 w-full border border-ink/15 rounded px-2 py-2 text-sm text-ink/80 bg-white"
          />
        </label>
      </div>

      <label className="block text-sm text-ink/70">
        Name
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Template name"
          className="mt-1 w-full border border-ink/15 rounded px-2 py-2 text-sm text-ink/80 bg-white"
        />
      </label>

      <label className="block text-sm text-ink/70">
        Description
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="What is this template for?"
          rows={2}
          className="mt-1 w-full border border-ink/15 rounded px-2 py-2 text-sm text-ink/80 bg-white"
        />
      </label>
    </div>
  );
}
