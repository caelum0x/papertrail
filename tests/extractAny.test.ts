import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";

// Offline oracle for multi-format extraction: no DB, no network, no LLM. Proves the
// router in extractAny dispatches each format to the right extractor, that text
// formats (CSV / Markdown / plain text) round-trip verbatim, that a real tiny XLSX
// buffer is parsed into a readable dump, that DOCX is dispatched to mammoth (mocked),
// and that unknown/binary input fails honestly rather than returning garbage.

// Mock mammoth so the DOCX path is exercised without a real .docx binary. The mock
// records that it was called with a Buffer and returns deterministic text.
const extractRawText = vi.fn(async ({ buffer }: { buffer: Buffer }) => {
  expect(Buffer.isBuffer(buffer)).toBe(true);
  return { value: "MOCK DOCX BODY", messages: [] };
});
vi.mock("mammoth", () => ({
  default: { extractRawText: (opts: { buffer: Buffer }) => extractRawText(opts) },
}));

import {
  extractAnyDocument,
  ACCEPTED_UPLOAD_FORMATS,
} from "../lib/ingestion/extractAny";

function utf8(s: string): Buffer {
  return Buffer.from(s, "utf-8");
}

describe("extractAnyDocument — text formats round-trip verbatim", () => {
  it("routes CSV by extension and preserves the raw comma-separated content", async () => {
    const csv = "drug,rrr\nDrugX,0.30\nDrugY,0.12";
    const r = await extractAnyDocument({ bytes: utf8(csv), filename: "trial.csv" });
    expect(r.format).toBe("csv");
    expect(r.engine).toBe("utf8");
    expect(r.text).toBe(csv);
  });

  it("routes Markdown by MIME and returns it as-is (no stripping)", async () => {
    const md = "# Title\n\n- **bold** point\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const r = await extractAnyDocument({
      bytes: utf8(md),
      filename: "notes.md",
      mimeType: "text/markdown",
    });
    expect(r.format).toBe("markdown");
    expect(r.text).toBe(md);
  });

  it("routes plain text and strips a leading UTF-8 BOM", async () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8("hello")]);
    const r = await extractAnyDocument({ bytes: withBom, filename: "note.txt" });
    expect(r.format).toBe("text");
    expect(r.text).toBe("hello");
  });
});

describe("extractAnyDocument — spreadsheet path (real tiny XLSX buffer)", () => {
  it("parses a real workbook into a per-sheet CSV dump", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["endpoint", "value"],
      ["mortality", 0.92],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const r = await extractAnyDocument({ bytes: buf, filename: "data.xlsx" });
    expect(r.format).toBe("spreadsheet");
    expect(r.engine).toBe("xlsx");
    expect(r.text).toContain("## Results");
    expect(r.text).toContain("endpoint,value");
    expect(r.text).toContain("mortality,0.92");
  });
});

describe("extractAnyDocument — DOCX dispatches to mammoth", () => {
  it("routes a .docx to the mammoth extractor (mocked)", async () => {
    extractRawText.mockClear();
    const r = await extractAnyDocument({
      bytes: utf8("PK not-a-real-docx"),
      filename: "protocol.docx",
    });
    expect(extractRawText).toHaveBeenCalledTimes(1);
    expect(r.format).toBe("docx");
    expect(r.engine).toBe("mammoth");
    expect(r.text).toBe("MOCK DOCX BODY");
  });

  it("routes by DOCX MIME type even without a .docx extension", async () => {
    extractRawText.mockClear();
    const r = await extractAnyDocument({
      bytes: utf8("PK stub"),
      filename: "upload.bin",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(extractRawText).toHaveBeenCalledTimes(1);
    expect(r.format).toBe("docx");
  });
});

describe("extractAnyDocument — PDF sniffing", () => {
  it("detects a PDF by its %PDF- magic bytes regardless of filename", async () => {
    // A %PDF- header with no valid body: extractDocument's unpdf path will throw,
    // which confirms the router *dispatched to the PDF path* (not text decode).
    const fakePdf = utf8("%PDF-1.7\nnot a real pdf");
    await expect(
      extractAnyDocument({ bytes: fakePdf, filename: "mystery.dat" })
    ).rejects.toBeTruthy();
  });
});

describe("extractAnyDocument — honest failure on unknown/binary", () => {
  it("throws a clear error listing accepted formats for an unknown type", async () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
    await expect(
      extractAnyDocument({ bytes: binary, filename: "thing.xyz" })
    ).rejects.toThrow(/Accepted formats/i);
  });
});

describe("ACCEPTED_UPLOAD_FORMATS", () => {
  it("advertises the seven accepted formats with ext/mime/label", () => {
    const exts = ACCEPTED_UPLOAD_FORMATS.map((f) => f.ext);
    expect(exts).toEqual(["pdf", "docx", "xlsx", "xls", "csv", "md", "txt"]);
    for (const f of ACCEPTED_UPLOAD_FORMATS) {
      expect(f.mime.length).toBeGreaterThan(0);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });
});
