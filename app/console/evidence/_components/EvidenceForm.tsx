import type { FormEvent } from "react";
import type { EvidenceSourceType } from "@/lib/evidence/types";
import type { CreateEvidencePayload } from "@/components/evidence/api";
import { SOURCE_TYPE_OPTIONS } from "@/components/evidence/labels";

// Controlled "add evidence" form. Form state lives in the page so it can refresh
// the list on success.

interface EvidenceFormProps {
  form: CreateEvidencePayload;
  tagsRaw: string;
  submitting: boolean;
  error: string | null;
  onFieldChange: (patch: Partial<CreateEvidencePayload>) => void;
  onTagsRawChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function EvidenceForm({
  form,
  tagsRaw,
  submitting,
  error,
  onFieldChange,
  onTagsRawChange,
  onSubmit,
}: EvidenceFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5 space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm text-ink/60">Source type</span>
          <select
            value={form.source_type}
            onChange={(e) =>
              onFieldChange({
                source_type: e.target.value as EvidenceSourceType,
              })
            }
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          >
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-ink/60">
            External id (PMID / NCT / DOI)
          </span>
          <input
            value={form.external_id ?? ""}
            onChange={(e) => onFieldChange({ external_id: e.target.value })}
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
            placeholder="e.g. 32109013"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm text-ink/60">Title</span>
        <input
          value={form.title}
          onChange={(e) => onFieldChange({ title: e.target.value })}
          required
          className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          placeholder="Study or document title"
        />
      </label>

      <label className="block">
        <span className="text-sm text-ink/60">URL</span>
        <input
          value={form.url ?? ""}
          onChange={(e) => onFieldChange({ url: e.target.value })}
          className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          placeholder="https://..."
        />
      </label>

      <label className="block">
        <span className="text-sm text-ink/60">Tags (comma-separated)</span>
        <input
          value={tagsRaw}
          onChange={(e) => onTagsRawChange(e.target.value)}
          className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          placeholder="oncology, phase-3"
        />
      </label>

      <label className="block">
        <span className="text-sm text-ink/60">Notes</span>
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => onFieldChange({ notes: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          placeholder="Why this source matters..."
        />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || form.title.trim().length === 0}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save evidence"}
        </button>
      </div>
    </form>
  );
}
