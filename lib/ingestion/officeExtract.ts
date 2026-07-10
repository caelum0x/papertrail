// Office / plain-text extractors for the ingestion pipeline. Each function is a pure
// async unit that turns raw file bytes into readable UTF-8 text (no DB, no network,
// no LLM). DOCX goes through mammoth; spreadsheets (XLSX/XLS) through SheetJS; CSV /
// Markdown / plain text are decoded as UTF-8. A corrupt or unreadable file throws a
// clear Error so the caller can surface an honest failure rather than storing garbage.

import mammoth from "mammoth";
import * as XLSX from "xlsx";

export interface OfficeExtraction {
  text: string;
  meta?: Record<string, unknown>;
}

// Normalize any byte input into a Node Buffer without mutating the caller's data.
function toBuffer(bytes: Uint8Array | ArrayBuffer | Buffer): Buffer {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// Decode raw bytes as UTF-8 text, tolerating a leading UTF-8 BOM.
function decodeUtf8(bytes: Uint8Array | ArrayBuffer | Buffer): string {
  const text = toBuffer(bytes).toString("utf-8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Extract the raw text of a .docx file via mammoth. Word markup, styles, and images
 * are dropped — only the readable body text is returned. Throws on a corrupt file.
 */
export async function extractDocx(
  bytes: Uint8Array | ArrayBuffer | Buffer
): Promise<OfficeExtraction> {
  try {
    const buffer = toBuffer(bytes);
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value ?? "",
      meta: { warnings: result.messages?.length ?? 0 },
    };
  } catch (err) {
    throw new Error(
      `Failed to extract DOCX: ${err instanceof Error ? err.message : "corrupt or unsupported file"}`
    );
  }
}

/**
 * Extract a spreadsheet (.xlsx/.xls) into a readable text dump via SheetJS. Every
 * sheet is emitted under a `## <sheet name>` header followed by its CSV rows, so a
 * downstream reader (human or Claude) can see the tabular structure. Throws on a
 * corrupt workbook.
 */
export async function extractSpreadsheet(
  bytes: Uint8Array | ArrayBuffer | Buffer
): Promise<OfficeExtraction> {
  try {
    const buffer = toBuffer(bytes);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames ?? [];

    const sections = sheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const csv = sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
      return `## ${name}\n${csv}`.trimEnd();
    });

    return {
      text: sections.join("\n\n").trim(),
      meta: { sheets: sheetNames.length, sheetNames },
    };
  } catch (err) {
    throw new Error(
      `Failed to extract spreadsheet: ${err instanceof Error ? err.message : "corrupt or unsupported file"}`
    );
  }
}

/**
 * Extract a CSV file as UTF-8 text. The raw comma-separated content is preserved
 * verbatim so the tabular structure survives into the store.
 */
export async function extractCsv(
  bytes: Uint8Array | ArrayBuffer | Buffer
): Promise<OfficeExtraction> {
  return { text: decodeUtf8(bytes) };
}

/**
 * Extract a plain-text file as UTF-8. No transformation beyond BOM stripping.
 */
export async function extractText(
  bytes: Uint8Array | ArrayBuffer | Buffer
): Promise<OfficeExtraction> {
  return { text: decodeUtf8(bytes) };
}

/**
 * Extract a Markdown file. Returned as-is (UTF-8, no stripping) so headings, tables,
 * and emphasis markers are preserved for downstream rendering or extraction.
 */
export async function extractMarkdown(
  bytes: Uint8Array | ArrayBuffer | Buffer
): Promise<OfficeExtraction> {
  return { text: decodeUtf8(bytes) };
}
