"use client";

// Admin-only form to publish a new release / changelog entry. Collapsed to a
// button until opened. Submits via the parent's onCreate handler.
import { useState } from "react";
import type { CreateReleasePayload } from "../api";

export function NewReleaseForm({
  onCreate,
  error,
}: {
  onCreate: (payload: CreateReleasePayload) => Promise<boolean>;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [releasedAt, setReleasedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setVersion("");
    setNotes("");
    setReleasedAt("");
  };

  const submit = async () => {
    setSubmitting(true);
    const payload: CreateReleasePayload = {
      version: version.trim(),
      notes: notes.trim() || undefined,
    };
    // The date input gives YYYY-MM-DD; widen to an ISO datetime for the API.
    if (releasedAt) {
      payload.releasedAt = new Date(`${releasedAt}T00:00:00.000Z`).toISOString();
    }
    const ok = await onCreate(payload);
    setSubmitting(false);
    if (ok) {
      reset();
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90"
      >
        New release
      </button>
    );
  }

  const canSubmit = version.trim().length > 0 && !submitting;

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/80">New release</h2>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Version (e.g. v1.4.0)"
            maxLength={60}
            className="w-48 rounded border border-ink/10 px-3 py-2 text-sm text-ink/80 placeholder:text-ink/30 focus:border-accent focus:outline-none"
          />
          <label className="flex items-center gap-2 text-xs text-ink/50">
            Released
            <input
              type="date"
              value={releasedAt}
              onChange={(e) => setReleasedAt(e.target.value)}
              className="rounded border border-ink/10 px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
            />
          </label>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Release notes (Markdown or plain text)..."
          rows={5}
          className="w-full rounded border border-ink/10 px-3 py-2 text-sm text-ink/80 placeholder:text-ink/30 focus:border-accent focus:outline-none"
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-40"
          >
            Publish release
          </button>
          <button
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="ml-auto text-sm text-ink/40 hover:text-ink/70"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
