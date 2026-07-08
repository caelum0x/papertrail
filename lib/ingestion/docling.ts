// Direct subprocess bridge to the merged Docling extractor (python/document_ai/
// docling_extract.py). This is a DIRECT process invocation — not an HTTP service.
// Docling (MIT) recovers structure (sections, tables, reading order) from scholarly
// PDFs; we call it when a Python runtime with Docling installed is available, and
// fall back to the in-process unpdf path otherwise.

import { spawn } from "node:child_process";
import path from "node:path";

export interface DoclingSection {
  label: string | null;
  text: string;
}

export interface DoclingResult {
  ok: boolean;
  markdown: string;
  text: string;
  sections: DoclingSection[];
  num_pages: number | null;
  error?: string;
}

const SCRIPT = path.join(process.cwd(), "python", "document_ai", "docling_extract.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 120_000;

/** True when Docling extraction is enabled (opt-in via env, since it needs Python + models). */
export function isDoclingEnabled(): boolean {
  return process.env.DOCLING_ENABLED === "true";
}

/**
 * Run the merged Docling extractor on a PDF path via a direct subprocess. Resolves
 * with the structured result, or rejects (the caller falls back to unpdf). Never
 * hangs: bounded by DEFAULT_TIMEOUT_MS.
 */
export function extractWithDocling(pdfPath: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DoclingResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [SCRIPT, pdfPath]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("docling extraction timed out"));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`docling exited ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        const parsed = JSON.parse(stdout) as DoclingResult;
        if (!parsed.ok) return reject(new Error(parsed.error || "docling reported failure"));
        resolve(parsed);
      } catch {
        reject(new Error("failed to parse docling output"));
      }
    });
  });
}
