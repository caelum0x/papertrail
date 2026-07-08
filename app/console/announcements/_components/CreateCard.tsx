"use client";

// Admin-only composer for a new announcement. Collapsed to a button until
// opened. Submits via the parent's onCreate handler; supports "Save draft" and
// "Publish now". Validation errors are surfaced inline.
import { useState } from "react";
import {
  ANNOUNCEMENT_KIND_OPTIONS,
  ANNOUNCEMENT_AUDIENCE_OPTIONS,
  type AnnouncementKind,
  type AnnouncementAudience,
  type CreateAnnouncementPayload,
} from "../api";

export function CreateCard({
  onCreate,
  error,
}: {
  onCreate: (payload: CreateAnnouncementPayload) => Promise<boolean>;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<AnnouncementKind>("general");
  const [audience, setAudience] = useState<AnnouncementAudience>("all");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle("");
    setBody("");
    setKind("general");
    setAudience("all");
  };

  const submit = async (publish: boolean) => {
    setSubmitting(true);
    const ok = await onCreate({
      title: title.trim(),
      body: body.trim(),
      kind,
      audience,
      publish,
    });
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
        New announcement
      </button>
    );
  }

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/80">New announcement</h2>
      <div className="mt-3 space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          maxLength={200}
          className="w-full rounded border border-ink/10 px-3 py-2 text-sm text-ink/80 placeholder:text-ink/30 focus:border-accent focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the announcement..."
          rows={5}
          className="w-full rounded border border-ink/10 px-3 py-2 text-sm text-ink/80 placeholder:text-ink/30 focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-ink/50">
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AnnouncementKind)}
              className="ml-2 rounded border border-ink/10 bg-white px-2 py-1 text-sm text-ink/80 focus:border-accent focus:outline-none"
            >
              {ANNOUNCEMENT_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink/50">
            Audience
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as AnnouncementAudience)}
              className="ml-2 rounded border border-ink/10 bg-white px-2 py-1 text-sm text-ink/80 focus:border-accent focus:outline-none"
            >
              {ANNOUNCEMENT_AUDIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void submit(true)}
            disabled={!canSubmit}
            className="rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-40"
          >
            Publish now
          </button>
          <button
            onClick={() => void submit(false)}
            disabled={!canSubmit}
            className="rounded border border-ink/10 px-3 py-2 text-sm text-ink/70 hover:bg-ink/5 disabled:opacity-40"
          >
            Save draft
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
