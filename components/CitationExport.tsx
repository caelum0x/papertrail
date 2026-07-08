"use client";

import { useState } from "react";
import {
  CitationSource,
  toBibTeX,
  toPlainCitation,
  toRIS,
} from "@/lib/citationFormats";

type Format = "bibtex" | "ris" | "plain";

interface CitationExportProps {
  source: CitationSource;
}

const FORMATS: { id: Format; label: string; build: (src: CitationSource) => string }[] = [
  { id: "bibtex", label: "Copy BibTeX", build: toBibTeX },
  { id: "ris", label: "Copy RIS", build: toRIS },
  { id: "plain", label: "Copy citation", build: toPlainCitation },
];

/**
 * Client-side citation export for the matched primary source. Each button copies
 * one reference format to the clipboard and briefly confirms with a "Copied"
 * state. No server round-trip, no LLM cost — the formats are built purely from
 * the already-rendered source.
 */
export function CitationExport({ source }: CitationExportProps) {
  const [copied, setCopied] = useState<Format | null>(null);

  async function copy(format: Format, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(format);
      setTimeout(() => setCopied((current) => (current === format ? null : current)), 1500);
    } catch {
      // Clipboard can be unavailable (permissions / insecure context). Fail
      // quietly rather than crash the result view — the source is still visible.
      setCopied(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {FORMATS.map((format) => (
        <button
          key={format.id}
          type="button"
          onClick={() => copy(format.id, format.build(source))}
          className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
        >
          {copied === format.id ? "Copied" : format.label}
        </button>
      ))}
    </div>
  );
}
