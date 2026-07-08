import { describe, it, expect } from "vitest";
import { buildSegments } from "../components/SourceHighlight";
import { GroundedSpan } from "../lib/grounding";

const RAW = "The drug reduced events by 30% in older adults over 12 months.";

function span(
  start: number,
  end: number,
  status: GroundedSpan["grounding"]["status"] = "exact",
  issue = "issue"
): GroundedSpan {
  return {
    claim_span: "claim",
    source_span: RAW.slice(start, end),
    issue,
    grounding: { status, start, end },
  };
}

function concat(text: string, spans: GroundedSpan[]): string {
  return buildSegments(text, spans)
    .map((s) => s.text)
    .join("");
}

describe("buildSegments", () => {
  it("returns a single plain segment when there are no spans", () => {
    const segments = buildSegments(RAW, []);
    expect(segments).toHaveLength(1);
    expect(segments[0].spanIndex).toBeNull();
    expect(segments[0].text).toBe(RAW);
  });

  it("partitions text so segments concatenate back to rawText", () => {
    const spans = [span(4, 8), span(27, 30)]; // "drug", "30%"
    expect(concat(RAW, spans)).toBe(RAW);
  });

  it("flags the correct ranges and carries the original span index", () => {
    const drug = span(4, 8); // "drug"
    const pct = span(RAW.indexOf("30%"), RAW.indexOf("30%") + 3); // "30%"
    const segments = buildSegments(RAW, [drug, pct]);

    const flagged = segments.filter((s) => s.spanIndex !== null);
    expect(flagged.map((s) => s.text)).toEqual(["drug", "30%"]);
    expect(flagged.map((s) => s.spanIndex)).toEqual([0, 1]);
    expect(flagged[0].span).toBe(drug);
  });

  it("preserves original indices when spans are given out of order", () => {
    const late = span(27, 30); // "30%" — later in text, earlier in array
    const early = span(4, 8); // "drug"
    const segments = buildSegments(RAW, [late, early]);

    const flagged = segments.filter((s) => s.spanIndex !== null);
    // Emitted in text order (drug then 30%) but indices map back to the input array.
    expect(flagged.map((s) => s.text)).toEqual(["drug", "30%"]);
    expect(flagged.map((s) => s.spanIndex)).toEqual([1, 0]);
  });

  it("skips a span that overlaps one already placed", () => {
    const a = span(4, 12); // "drug red"
    const b = span(8, 15); // overlaps a
    const segments = buildSegments(RAW, [a, b]);

    const flagged = segments.filter((s) => s.spanIndex !== null);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].spanIndex).toBe(0);
    expect(concat(RAW, [a, b])).toBe(RAW);
  });

  it("skips out-of-range offsets without throwing", () => {
    const bad: GroundedSpan = {
      claim_span: "c",
      source_span: "x",
      issue: "i",
      grounding: { status: "exact", start: 5, end: RAW.length + 50 },
    };
    const good = span(4, 8);
    const segments = buildSegments(RAW, [bad, good]);

    const flagged = segments.filter((s) => s.spanIndex !== null);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].text).toBe("drug");
    expect(concat(RAW, [bad, good])).toBe(RAW);
  });

  it("skips inverted/empty ranges (start >= end)", () => {
    const empty = span(8, 8);
    expect(buildSegments(RAW, [empty]).every((s) => s.spanIndex === null)).toBe(true);
  });
});
