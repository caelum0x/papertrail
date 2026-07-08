import { describe, it, expect } from "vitest";
import { locateSpan, groundFlaggedSpans } from "../lib/grounding";
import { FlaggedSpan } from "../lib/schemas";

const SOURCE = `In the CLARITY-AD trial, lecanemab reduced clinical decline on the CDR-SB
by 0.45 points versus placebo at 18 months. ARIA-E (edema) occurred in 12.6% of the
lecanemab group. The benefit was not statistically significant in the female subgroup.`;

describe("locateSpan", () => {
  it("finds an exact substring and reports offsets that slice back to itself", () => {
    const span = "ARIA-E (edema) occurred in 12.6%";
    const located = locateSpan(SOURCE, span);
    expect(located).not.toBeNull();
    expect(located!.status).toBe("exact");
    expect(SOURCE.slice(located!.start, located!.end)).toBe(span);
  });

  it("recovers the VERBATIM source text when the candidate has collapsed whitespace", () => {
    // The model returned the quote with single spaces; the source wraps it across a newline.
    const candidate = "clinical decline on the CDR-SB by 0.45 points";
    const located = locateSpan(SOURCE, candidate);
    expect(located).not.toBeNull();
    expect(located!.status).toBe("approximate");
    // The returned text is the exact original (which contains a newline), NOT the candidate.
    const verbatim = SOURCE.slice(located!.start, located!.end);
    expect(verbatim).toBe(located!.text);
    expect(verbatim.replace(/\s+/g, " ")).toBe(candidate);
    expect(verbatim).toContain("\n"); // proves we recovered the wrapped original
  });

  it("returns null for a fabricated quote not present in the source", () => {
    expect(locateSpan(SOURCE, "lecanemab cured 90% of patients")).toBeNull();
  });

  it("returns null for an empty or whitespace-only candidate", () => {
    expect(locateSpan(SOURCE, "")).toBeNull();
    expect(locateSpan(SOURCE, "   \n  ")).toBeNull();
  });
});

describe("groundFlaggedSpans — the core trust invariant", () => {
  it("keeps locatable spans (with verbatim text) and DROPS fabricated ones", () => {
    const flagged: FlaggedSpan[] = [
      {
        claim_span: "27% reduction",
        source_span: "0.45 points versus placebo", // real
        issue: "relative vs absolute",
      },
      {
        claim_span: "safe",
        source_span: "no adverse events were observed", // FABRICATED — not in source
        issue: "omits ARIA-E",
      },
    ];
    const { spans, droppedCount } = groundFlaggedSpans(flagged, SOURCE);
    expect(droppedCount).toBe(1);
    expect(spans).toHaveLength(1);
    expect(spans[0].source_span).toBe("0.45 points versus placebo");
    // Every surviving span must slice back to its own source text — the guarantee.
    for (const s of spans) {
      expect(SOURCE.slice(s.grounding.start, s.grounding.end)).toBe(s.source_span);
    }
  });

  it("returns an empty set (not an error) when every span is ungroundable", () => {
    const flagged: FlaggedSpan[] = [
      { claim_span: "x", source_span: "totally made up quote", issue: "y" },
    ];
    const { spans, droppedCount } = groundFlaggedSpans(flagged, SOURCE);
    expect(spans).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });
});
