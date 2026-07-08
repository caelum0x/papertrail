"use client";

import { useRef } from "react";
import {
  IMPORT_FORMATS,
  IMPORT_TARGETS,
  type ImportFormat,
  type ImportTarget,
} from "@/lib/import/types";
import type { ReferenceLibraryDto } from "./api";

// Step 1: choose target + format, paste or upload the file contents, and (for
// references) pick a destination library. Controlled by the parent wizard.
export function UploadStep({
  target,
  format,
  text,
  libraryId,
  libraries,
  librariesError,
  onTarget,
  onFormat,
  onText,
  onLibrary,
  onNext,
}: {
  target: ImportTarget;
  format: ImportFormat;
  text: string;
  libraryId: string;
  libraries: ReferenceLibraryDto[];
  librariesError: string | null;
  onTarget: (t: ImportTarget) => void;
  onFormat: (f: ImportFormat) => void;
  onText: (v: string) => void;
  onLibrary: (id: string) => void;
  onNext: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    const content = await file.text();
    onText(content);
  };

  const needsLibrary = target === "references";
  const canNext =
    text.trim().length > 0 && (!needsLibrary || libraryId.length > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="text-ink/60">Target</span>
          <select
            value={target}
            onChange={(e) => onTarget(e.target.value as ImportTarget)}
            className="mt-1 w-full rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
          >
            {IMPORT_TARGETS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-ink/60">Format</span>
          <select
            value={format}
            onChange={(e) => onFormat(e.target.value as ImportFormat)}
            className="mt-1 w-full rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
          >
            {IMPORT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      {needsLibrary ? (
        <label className="block text-sm">
          <span className="text-ink/60">Destination library</span>
          {librariesError ? (
            <p className="mt-1 text-sm text-red-600">{librariesError}</p>
          ) : (
            <select
              value={libraryId}
              onChange={(e) => onLibrary(e.target.value)}
              className="mt-1 w-full rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">Select a library…</option>
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name}
                </option>
              ))}
            </select>
          )}
          {!librariesError && libraries.length === 0 ? (
            <p className="mt-1 text-xs text-ink/40">
              No reference libraries yet. Create one under References first.
            </p>
          ) : null}
        </label>
      ) : null}

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink/60">File contents</span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-xs text-accent hover:underline"
          >
            Upload a file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.bib,.ris,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </div>
        <textarea
          value={text}
          onChange={(e) => onText(e.target.value)}
          rows={12}
          placeholder={
            format === "csv"
              ? "title,doi,year\nExample,10.1000/x,2024"
              : "Paste your BibTeX or RIS records here…"
          }
          className="mt-1 w-full rounded border border-ink/10 bg-white p-2 font-mono text-xs"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          Next: map columns
        </button>
      </div>
    </div>
  );
}
