// Unified document extraction entry point for the ingestion pipeline. Prefers the
// merged Docling extractor (richer structure for scholarly papers) when enabled and
// available; otherwise uses the in-process unpdf path. Both are MIT-licensed and run
// inside the repo — no external HTTP service.

import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractPdf } from "./pdfExtract";
import { extractWithDocling, isDoclingEnabled } from "./docling";

export interface DocumentExtraction {
  engine: "docling" | "unpdf";
  fullText: string;
  markdown: string | null;
  totalPages: number | null;
  pages: { pageNumber: number; text: string }[];
}

/**
 * Extract text (and structure, when Docling is available) from a PDF's raw bytes.
 * Falls back from Docling to unpdf on any failure so ingestion of a large paper
 * library never hard-fails on one document.
 */
export async function extractDocument(bytes: Uint8Array | Buffer): Promise<DocumentExtraction> {
  if (isDoclingEnabled()) {
    let tmp = "";
    try {
      tmp = path.join(tmpdir(), `pt-${Date.now()}-${process.pid}.pdf`);
      await writeFile(tmp, Buffer.from(bytes));
      const d = await extractWithDocling(tmp);
      return {
        engine: "docling",
        fullText: d.text,
        markdown: d.markdown,
        totalPages: d.num_pages,
        pages: [],
      };
    } catch {
      // fall through to the in-process path
    } finally {
      if (tmp) await unlink(tmp).catch(() => {});
    }
  }

  const r = await extractPdf(bytes);
  return {
    engine: "unpdf",
    fullText: r.fullText,
    markdown: null,
    totalPages: r.totalPages,
    pages: r.pages,
  };
}
