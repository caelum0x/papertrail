import type { FormEvent } from "react";

// Controlled text-document upload form. State + submit handler live in the page.

interface UploadFormProps {
  filename: string;
  text: string;
  submitting: boolean;
  error: string | null;
  forbidden: boolean;
  onFilenameChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function UploadForm({
  filename,
  text,
  submitting,
  error,
  forbidden,
  onFilenameChange,
  onTextChange,
  onSubmit,
}: UploadFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5"
    >
      <h2 className="text-sm font-medium text-ink/70">Upload text document</h2>
      <div className="mt-3 grid gap-3">
        <input
          type="text"
          value={filename}
          onChange={(e) => onFilenameChange(e.target.value)}
          placeholder="Filename (e.g. trial-2021.txt)"
          className="border border-ink/15 rounded px-3 py-2 text-sm text-ink/80 focus:outline-none focus:border-accent"
        />
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Paste the document text here..."
          rows={6}
          className="border border-ink/15 rounded px-3 py-2 text-sm text-ink/80 focus:outline-none focus:border-accent font-mono"
        />
        {error ? (
          <p className="text-sm text-red-600">
            {forbidden
              ? "You don't have permission to upload documents."
              : error}
          </p>
        ) : null}
        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </form>
  );
}
