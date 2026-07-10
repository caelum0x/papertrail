import { describe, it, expect } from "vitest";
import { sanitizeClaimText } from "@/lib/api/claimInput";

const NUL = String.fromCharCode(0x00);
const BELL = String.fromCharCode(0x07);
const ESC = String.fromCharCode(0x1b);
const ZERO_WIDTH_SPACE = "​";
const RLO = "‮"; // right-to-left override (bidi smuggling)

describe("sanitizeClaimText", () => {
  it("accepts a normal claim and trims surrounding whitespace", () => {
    const r = sanitizeClaimText("  Drug X reduced events by 30%.  ");
    expect(r).toEqual({ ok: true, value: "Drug X reduced events by 30%." });
  });

  it("preserves internal whitespace (tabs/newlines are legitimate)", () => {
    const r = sanitizeClaimText("line one\n\tline two");
    expect(r.ok && r.value).toBe("line one\n\tline two");
  });

  it("rejects non-string input", () => {
    expect(sanitizeClaimText(undefined).ok).toBe(false);
    expect(sanitizeClaimText(42 as unknown).ok).toBe(false);
  });

  it("rejects control characters (NUL / bell / escape)", () => {
    expect(sanitizeClaimText(`hello${NUL}world`).ok).toBe(false);
    expect(sanitizeClaimText(`hello${BELL}world`).ok).toBe(false);
    expect(sanitizeClaimText(`hello${ESC}world`).ok).toBe(false);
  });

  it("strips invisible/bidi characters rather than rejecting the whole claim", () => {
    const r = sanitizeClaimText(`Drug${ZERO_WIDTH_SPACE}X reduced${RLO} events`);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe("DrugX reduced events");
  });

  it("rejects input that is empty once cleaned", () => {
    expect(sanitizeClaimText("   ").ok).toBe(false);
    expect(sanitizeClaimText(`${ZERO_WIDTH_SPACE}${ZERO_WIDTH_SPACE}`).ok).toBe(false);
  });

  it("rejects degenerate single-character repetition", () => {
    expect(sanitizeClaimText("aaaaaaaaaaaaaaaa").ok).toBe(false);
    // Short repeats are allowed (min/max length is the caller's job).
    expect(sanitizeClaimText("aaaa").ok).toBe(true);
  });
});
