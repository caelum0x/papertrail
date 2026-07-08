// In-process PDF text extraction using unpdf (MIT) — a serverless pdf.js build,
// imported directly (no HTTP service, no external worker). Handles hundreds of pages
// per document; returns per-page text so downstream claim/finding extraction can cite
// the exact page a statement came from.

import { extractText, getDocumentProxy } from "unpdf";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractedPdf {
  totalPages: number;
  pages: ExtractedPage[];
  fullText: string;
}

/**
 * Extract text from a PDF, page by page. Accepts raw bytes (Uint8Array/ArrayBuffer/
 * Node Buffer). Deterministic; no network. Empty/garbage pages become empty strings
 * rather than throwing, so a single bad page never sinks a large document.
 */
export async function extractPdf(data: Uint8Array | ArrayBuffer | Buffer): Promise<ExtractedPdf> {
  // unpdf requires a *plain* Uint8Array — a Node Buffer (a Uint8Array subclass) is
  // rejected — so always produce a fresh, exactly-sized Uint8Array copy.
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pageTexts: string[] = Array.isArray(text) ? text : [text];
  const pages: ExtractedPage[] = pageTexts.map((t, i) => ({
    pageNumber: i + 1,
    text: normalize(t ?? ""),
  }));

  return {
    totalPages: typeof totalPages === "number" ? totalPages : pages.length,
    pages,
    fullText: pages.map((p) => p.text).filter(Boolean).join("\n\n"),
  };
}

function normalize(s: string): string {
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
