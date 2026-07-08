import { describe, it, expect } from "vitest";
import { toCsv } from "../lib/csvExport";

describe("toCsv", () => {
  it("emits a header row even for empty input", () => {
    expect(toCsv([], ["id", "claim_text"])).toBe("id,claim_text");
  });

  it("orders cells by the supplied columns and fills missing fields with empty strings", () => {
    const csv = toCsv([{ id: "1", trust_score: 90 }], ["id", "claim_text", "trust_score"]);
    expect(csv).toBe("id,claim_text,trust_score\r\n1,,90");
  });

  it("quotes fields containing commas", () => {
    const csv = toCsv([{ claim_text: "Drug X, given daily" }], ["claim_text"]);
    expect(csv).toBe('claim_text\r\n"Drug X, given daily"');
  });

  it("quotes fields containing double quotes and doubles interior quotes", () => {
    const csv = toCsv([{ claim_text: 'He said "cured"' }], ["claim_text"]);
    expect(csv).toBe('claim_text\r\n"He said ""cured"""');
  });

  it("quotes fields containing newlines", () => {
    const csv = toCsv([{ claim_text: "line1\nline2" }], ["claim_text"]);
    expect(csv).toBe('claim_text\r\n"line1\nline2"');
  });

  it("quotes header cells that need escaping", () => {
    expect(toCsv([], ["a,b"])).toBe('"a,b"');
  });

  it("separates multiple rows with CRLF", () => {
    const csv = toCsv([{ id: "1" }, { id: "2" }], ["id"]);
    expect(csv).toBe("id\r\n1\r\n2");
  });

  it("coerces numeric fields to strings", () => {
    const csv = toCsv([{ trust_score: 0 }], ["trust_score"]);
    expect(csv).toBe("trust_score\r\n0");
  });

  it("is deterministic for the same input", () => {
    const rows = [{ id: "1", claim_text: "a" }];
    expect(toCsv(rows, ["id", "claim_text"])).toBe(toCsv(rows, ["id", "claim_text"]));
  });
});
