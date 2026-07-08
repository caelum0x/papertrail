"use client";

import { useState } from "react";
import { TemplateMetaFields } from "./TemplateMetaFields";
import { TemplateBodyFields } from "./TemplateBodyFields";
import {
  emptyBody,
  type TemplateBody,
  type TemplateKind,
} from "@/app/console/templates/api";

export interface TemplateFormValues {
  kind: TemplateKind;
  name: string;
  description: string;
  category: string;
  body: TemplateBody;
}

interface TemplateFormProps {
  initial?: Partial<TemplateFormValues>;
  kindLocked?: boolean;
  submitLabel: string;
  submitting: boolean;
  error?: string | null;
  onSubmit: (values: TemplateFormValues) => void;
  onCancel?: () => void;
}

function defaults(initial?: Partial<TemplateFormValues>): TemplateFormValues {
  return {
    kind: initial?.kind ?? "claim",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    category: initial?.category ?? "",
    body: initial?.body ?? emptyBody(),
  };
}

// Controlled template form composed of the meta and body field groups. Owns its
// own draft state; validates that the name is present before delegating submit
// to the parent (which performs the API call).
export function TemplateForm({
  initial,
  kindLocked,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
}: TemplateFormProps) {
  const [values, setValues] = useState<TemplateFormValues>(defaults(initial));
  const [localError, setLocalError] = useState<string | null>(null);

  const set = <K extends keyof TemplateFormValues>(
    key: K,
    value: TemplateFormValues[K]
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) {
      setLocalError("Template name is required.");
      return;
    }
    setLocalError(null);
    onSubmit({ ...values, name: values.name.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white border border-ink/10 rounded-lg p-5">
        <TemplateMetaFields
          kind={values.kind}
          name={values.name}
          description={values.description}
          category={values.category}
          kindLocked={kindLocked}
          onKindChange={(kind) => set("kind", kind)}
          onNameChange={(name) => set("name", name)}
          onDescriptionChange={(description) => set("description", description)}
          onCategoryChange={(category) => set("category", category)}
        />
      </div>

      <div className="bg-white border border-ink/10 rounded-lg p-5">
        <TemplateBodyFields
          body={values.body}
          onChange={(body) => set("body", body)}
        />
      </div>

      {localError || error ? (
        <p className="text-sm text-red-600">{localError ?? error}</p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="text-sm bg-accent text-white rounded px-4 py-2 hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-ink/60 hover:text-ink/80"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
