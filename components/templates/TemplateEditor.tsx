"use client";

import { useState } from "react";
import { TemplateMetaFields } from "./TemplateMetaFields";
import { TemplateBodyFields } from "./TemplateBodyFields";
import type { TemplateBody, TemplateDto } from "@/app/console/templates/api";

export interface TemplateEditorValues {
  name: string;
  description: string;
  category: string;
  body: TemplateBody;
}

interface TemplateEditorProps {
  template: TemplateDto;
  saving: boolean;
  error?: string | null;
  onSave: (values: TemplateEditorValues) => void;
}

// The editor panel on the detail page. Seeds its draft from the loaded template
// and issues a PATCH via the parent's onSave. Kind is shown but locked.
export function TemplateEditor({
  template,
  saving,
  error,
  onSave,
}: TemplateEditorProps) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [category, setCategory] = useState(template.category ?? "");
  const [body, setBody] = useState<TemplateBody>(template.body);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSave = () => {
    if (!name.trim()) {
      setLocalError("Template name is required.");
      return;
    }
    setLocalError(null);
    onSave({ name: name.trim(), description, category, body });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-ink/10 rounded-lg p-5">
        <TemplateMetaFields
          kind={template.kind}
          name={name}
          description={description}
          category={category}
          kindLocked
          onKindChange={() => undefined}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onCategoryChange={setCategory}
        />
      </div>

      <div className="bg-white border border-ink/10 rounded-lg p-5">
        <TemplateBodyFields body={body} onChange={setBody} />
      </div>

      {localError || error ? (
        <p className="text-sm text-red-600">{localError ?? error}</p>
      ) : null}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="text-sm bg-accent text-white rounded px-4 py-2 hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save changes"}
      </button>
    </div>
  );
}
