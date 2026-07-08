"use client";

import { FieldEditor } from "./FieldEditor";
import type { TemplateBody } from "@/app/console/templates/api";

interface TemplateBodyFieldsProps {
  body: TemplateBody;
  onChange: (body: TemplateBody) => void;
}

// The body field group: the free-form content skeleton plus the field editor.
// Immutable updates — spreads the body on every change.
export function TemplateBodyFields({ body, onChange }: TemplateBodyFieldsProps) {
  return (
    <div className="space-y-4">
      <label className="block text-sm text-ink/70">
        Content
        <textarea
          value={body.content}
          onChange={(e) => onChange({ ...body, content: e.target.value })}
          placeholder="Skeleton content, boilerplate, or prompt text..."
          rows={6}
          className="mt-1 w-full border border-ink/15 rounded px-2 py-2 text-sm text-ink/80 bg-white font-mono"
        />
      </label>

      <FieldEditor
        fields={body.fields}
        onChange={(fields) => onChange({ ...body, fields })}
      />
    </div>
  );
}
