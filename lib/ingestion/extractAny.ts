// Format-agnostic document extraction entry point. Given raw bytes plus whatever
// hints we have (filename, MIME type), route to the correct extractor and return the
// plain text plus which format/engine produced it. Every accepted format is declared
// once in ACCEPTED_UPLOAD_FORMATS so the API and UI stay in sync. An unknown or
// binary type produces an honest error rather than a garbled UTF-8 decode.

import { extractDocument } from "./extractDocument";
import {
  extractDocx,
  extractSpreadsheet,
  extractCsv,
  extractText,
  extractMarkdown,
} from "./officeExtract";

export type UploadFormat =
  | "pdf"
  | "docx"
  | "spreadsheet"
  | "csv"
  | "markdown"
  | "text";

export interface AcceptedUploadFormat {
  ext: string;
  mime: string;
  label: string;
}

// The single source of truth for what the platform accepts. The API advertises these
// MIME types / extensions and the UI can render this list directly.
export const ACCEPTED_UPLOAD_FORMATS: readonly AcceptedUploadFormat[] = [
  { ext: "pdf", mime: "application/pdf", label: "PDF" },
  {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word (DOCX)",
  },
  {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel (XLSX)",
  },
  { ext: "xls", mime: "application/vnd.ms-excel", label: "Excel (XLS)" },
  { ext: "csv", mime: "text/csv", label: "CSV" },
  { ext: "md", mime: "text/markdown", label: "Markdown" },
  { ext: "txt", mime: "text/plain", label: "Plain text" },
] as const;

export interface ExtractAnyInput {
  bytes: Uint8Array | ArrayBuffer | Buffer;
  filename?: string | null;
  mimeType?: string | null;
}

export interface ExtractAnyResult {
  text: string;
  format: UploadFormat;
  engine: string;
}

// Map a filename to its lowercased extension (no dot). Returns "" when absent.
function extensionOf(filename?: string | null): string {
  if (!filename) return "";
  const match = /\.([a-z0-9]+)\s*$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

// Resolve the target format from MIME type first, then extension, then byte sniffing.
// Returns null when nothing identifies a supported format.
function resolveFormat(
  bytes: Buffer,
  ext: string,
  mime: string
): UploadFormat | null {
  const m = mime.toLowerCase();

  // Byte-level PDF sniff wins regardless of a misleading MIME/extension.
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";

  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (
    m.includes("wordprocessingml") ||
    m === "application/msword" ||
    ext === "docx"
  ) {
    return "docx";
  }
  if (
    m.includes("spreadsheetml") ||
    m === "application/vnd.ms-excel" ||
    ext === "xlsx" ||
    ext === "xls"
  ) {
    return "spreadsheet";
  }
  if (m === "text/csv" || ext === "csv") return "csv";
  if (m === "text/markdown" || m === "text/x-markdown" || ext === "md" || ext === "markdown") {
    return "markdown";
  }
  if (m === "text/plain" || ext === "txt") return "text";

  return null;
}

/**
 * Extract plain text from any accepted document format. Routes by MIME/extension/byte
 * signature and delegates to the matching extractor. Unknown or binary input throws a
 * clear error listing the accepted formats. Never logs or returns the file bytes.
 */
export async function extractAnyDocument(
  input: ExtractAnyInput
): Promise<ExtractAnyResult> {
  const bytes = toBuffer(input.bytes);
  const ext = extensionOf(input.filename);
  const mime = (input.mimeType ?? "").trim();

  const format = resolveFormat(bytes, ext, mime);
  if (!format) {
    const accepted = ACCEPTED_UPLOAD_FORMATS.map((f) => f.label).join(", ");
    throw new Error(
      `Unsupported file type. Accepted formats: ${accepted}.`
    );
  }

  switch (format) {
    case "pdf": {
      const doc = await extractDocument(bytes);
      return { text: doc.fullText, format, engine: doc.engine };
    }
    case "docx": {
      const r = await extractDocx(bytes);
      return { text: r.text, format, engine: "mammoth" };
    }
    case "spreadsheet": {
      const r = await extractSpreadsheet(bytes);
      return { text: r.text, format, engine: "xlsx" };
    }
    case "csv": {
      const r = await extractCsv(bytes);
      return { text: r.text, format, engine: "utf8" };
    }
    case "markdown": {
      const r = await extractMarkdown(bytes);
      return { text: r.text, format, engine: "utf8" };
    }
    case "text": {
      const r = await extractText(bytes);
      return { text: r.text, format, engine: "utf8" };
    }
  }
}

function toBuffer(bytes: Uint8Array | ArrayBuffer | Buffer): Buffer {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
