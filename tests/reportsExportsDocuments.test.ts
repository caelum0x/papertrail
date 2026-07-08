import { describe, it, expect } from "vitest";
import {
  contentTypeFor,
  extensionFor,
  serialize,
  toCsv,
  toMarkdown,
  type Column,
  type Row,
} from "../lib/reports-exports/documents";

const COLUMNS: Column[] = [
  { key: "id", label: "ID" },
  { key: "text", label: "Claim Text" },
  { key: "trust_score", label: "Trust Score" },
];

const FIXED_DATE = new Date("2026-07-08T12:00:00.000Z");

describe("toCsv", () => {
  it("emits only the header row for empty input", () => {
    expect(toCsv([], COLUMNS)).toBe("ID,Claim Text,Trust Score");
  });

  it("orders cells by column and renders null/undefined as empty strings", () => {
    const rows: Row[] = [{ id: "1", trust_score: 90 }];
    expect(toCsv(rows, COLUMNS)).toBe("ID,Claim Text,Trust Score\r\n1,,90");
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const rows: Row[] = [{ id: "1", text: 'Drug X, "cured"\ndaily', trust_score: 5 }];
    expect(toCsv(rows, COLUMNS)).toBe(
      'ID,Claim Text,Trust Score\r\n1,"Drug X, ""cured""\ndaily",5'
    );
  });

  it("stringifies boolean cells", () => {
    const rows: Row[] = [{ id: "1", text: true, trust_score: 0 }];
    expect(toCsv(rows, COLUMNS)).toBe("ID,Claim Text,Trust Score\r\n1,true,0");
  });
});

describe("toMarkdown", () => {
  it("renders a title, generated line, and table with an empty-state note", () => {
    const md = toMarkdown([], COLUMNS, "Claims export", FIXED_DATE);
    expect(md).toContain("# Claims export");
    expect(md).toContain("_Generated 2026-07-08T12:00:00.000Z · 0 rows_");
    expect(md).toContain("| ID | Claim Text | Trust Score |");
    expect(md).toContain("| --- | --- | --- |");
    expect(md).toContain("_No rows matched this export._");
  });

  it("escapes pipes and collapses newlines in cells", () => {
    const rows: Row[] = [{ id: "1", text: "a | b\nc", trust_score: 3 }];
    const md = toMarkdown(rows, COLUMNS, "T", FIXED_DATE);
    expect(md).toContain("| 1 | a \\| b c | 3 |");
  });
});

describe("serialize / helpers", () => {
  it("dispatches to CSV for csv format", () => {
    const out = serialize("csv", [{ id: "1" }], COLUMNS, "T", FIXED_DATE);
    expect(out.startsWith("ID,Claim Text,Trust Score")).toBe(true);
  });

  it("dispatches to Markdown for markdown format", () => {
    const out = serialize("markdown", [], COLUMNS, "My Title", FIXED_DATE);
    expect(out.startsWith("# My Title")).toBe(true);
  });

  it("maps formats to content types and extensions", () => {
    expect(contentTypeFor("csv")).toContain("text/csv");
    expect(contentTypeFor("markdown")).toContain("text/markdown");
    expect(extensionFor("csv")).toBe("csv");
    expect(extensionFor("markdown")).toBe("md");
  });
});
