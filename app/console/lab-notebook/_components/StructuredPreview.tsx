"use client";

import { useState } from "react";
import { StructuredRecord } from "./StructuredRecord";
import type { StructureResponse } from "./types";

// Preview of a freshly-structured (not yet saved) record. The scientist reviews the
// grounded record, edits the title/date/tags, then saves it. Surfaces the dropped-count
// honestly — items Claude produced that couldn't be grounded were discarded, never shown
// as if sourced.

interface StructuredPreviewProps {
  preview: StructureResponse;
  defaultTitle: string;
  defaultDate: string | null;
  onSave: (input: { title: string; experimentDate: string | null; tags: string[] }) => void;
  saving: boolean;
  saveError: string | null;
}

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    )
  );
}

export function StructuredPreview({
  preview,
  defaultTitle,
  defaultDate,
  onSave,
  saving,
  saveError,
}: StructuredPreviewProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [date, setDate] = useState(defaultDate ?? "");
  const [tagsRaw, setTagsRaw] = useState(
    preview.structured.entities.map((e) => e.name).slice(0, 6).join(", ")
  );

  const canSave = title.trim().length > 0 && !saving;

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink/70">Structured record</h3>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
          Grounded to your notes
        </span>
      </div>

      {preview.droppedUngrounded > 0 ? (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {preview.droppedUngrounded} item
          {preview.droppedUngrounded === 1 ? " was" : "s were"} dropped because the quote
          couldn&rsquo;t be located verbatim in your notes. PaperTrail never keeps an
          unsourced claim about your record.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-ink/50" htmlFor="exp-title">
            Title
          </label>
          <input
            id="exp-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/50" htmlFor="exp-date">
            Experiment date
          </label>
          <input
            id="exp-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-ink/50" htmlFor="exp-tags">
            Tags (comma-separated)
          </label>
          <input
            id="exp-tags"
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="e.g. p53, HEK293T, western blot"
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-5 border-t border-ink/15 pt-4">
        <StructuredRecord structured={preview.structured} />
      </div>

      {saveError ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            onSave({
              title: title.trim(),
              experimentDate: date.trim() === "" ? null : date.trim(),
              tags: parseTags(tagsRaw),
            })
          }
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save experiment"}
        </button>
      </div>
    </div>
  );
}
