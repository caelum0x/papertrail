import type { FormEvent } from "react";
import Link from "next/link";

// Controlled create-claim form. State + submit live in the page so it can route
// to the created claim on success.

interface NewClaimFormProps {
  text: string;
  projectId: string;
  citedSourceUrl: string;
  submitting: boolean;
  error: string | null;
  onTextChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
  onCitedSourceUrlChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function NewClaimForm({
  text,
  projectId,
  citedSourceUrl,
  submitting,
  error,
  onTextChange,
  onProjectIdChange,
  onCitedSourceUrlChange,
  onSubmit,
}: NewClaimFormProps) {
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <div>
        <label
          htmlFor="claim-text"
          className="block text-sm font-medium text-ink/70"
        >
          Claim text <span className="text-accent">*</span>
        </label>
        <textarea
          id="claim-text"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          rows={4}
          required
          maxLength={5000}
          placeholder='e.g. "Drug X reduced cardiovascular events by 30% in adults with type 2 diabetes."'
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label
          htmlFor="project-id"
          className="block text-sm font-medium text-ink/70"
        >
          Project ID <span className="text-ink/40">(optional)</span>
        </label>
        <input
          id="project-id"
          type="text"
          value={projectId}
          onChange={(e) => onProjectIdChange(e.target.value)}
          placeholder="Associate with a project (UUID)"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label
          htmlFor="cited-source"
          className="block text-sm font-medium text-ink/70"
        >
          Cited source URL <span className="text-ink/40">(optional)</span>
        </label>
        <input
          id="cited-source"
          type="url"
          value={citedSourceUrl}
          onChange={(e) => onCitedSourceUrlChange(e.target.value)}
          placeholder="https://pubmed.ncbi.nlm.nih.gov/..."
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit claim"}
        </button>
        <Link
          href="/console/claims"
          className="text-sm text-ink/60 hover:text-ink/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
