import { describe, it, expect } from "vitest";
import {
  contextualRerank,
  filterAndRank,
  RELEVANCE_THRESHOLD,
  type ContextScorer,
  type RerankSource,
  type RerankedSource,
} from "../lib/retrieval/contextualRerank";

// Oracle tests for the native paper-qa RCS (relevance-scored contextual
// summarization) rerank port. The load-bearing guarantee is the deterministic
// half of paper-qa's evidence step: given a per-source relevance score (0-10),
// sources BELOW the threshold are dropped and the survivors are RE-ORDERED by
// descending score. The Claude-backed scorer is injected here so every assertion
// runs fully offline against mocked scores.

// A scorer driven by a fixed id -> {score, summary} table. Any source not in the
// table gets score 0 (paper-qa's "not applicable" sentinel).
function mockScorer(
  table: Record<string, { relevanceScore: number; contextSummary: string }>
): ContextScorer {
  return async (_query, source: RerankSource) =>
    table[source.id] ?? { relevanceScore: 0, contextSummary: "" };
}

const src = (id: string, raw_text = `text-${id}`): RerankSource => ({
  id,
  raw_text,
});

describe("filterAndRank (pure) — threshold + re-ordering oracle", () => {
  it("drops below-threshold sources and orders survivors by descending score", () => {
    const scored: RerankedSource[] = [
      { id: "low", raw_text: "t", relevanceScore: 2, contextSummary: "s" },
      { id: "high", raw_text: "t", relevanceScore: 9, contextSummary: "s" },
      { id: "mid", raw_text: "t", relevanceScore: 6, contextSummary: "s" },
      { id: "zero", raw_text: "t", relevanceScore: 0, contextSummary: "" },
    ];

    const ranked = filterAndRank(scored, 5);

    // Below-threshold (low=2, zero=0) removed; survivors sorted high->low.
    expect(ranked.map((r) => r.id)).toEqual(["high", "mid"]);
  });

  it("keeps sources exactly AT the threshold (>= is inclusive)", () => {
    const scored: RerankedSource[] = [
      { id: "at", raw_text: "t", relevanceScore: 5, contextSummary: "s" },
      { id: "below", raw_text: "t", relevanceScore: 4, contextSummary: "s" },
    ];
    expect(filterAndRank(scored, 5).map((r) => r.id)).toEqual(["at"]);
  });

  it("breaks score ties by stable ascending id for deterministic ordering", () => {
    const scored: RerankedSource[] = [
      { id: "b", raw_text: "t", relevanceScore: 8, contextSummary: "s" },
      { id: "a", raw_text: "t", relevanceScore: 8, contextSummary: "s" },
      { id: "c", raw_text: "t", relevanceScore: 8, contextSummary: "s" },
    ];
    expect(filterAndRank(scored, 5).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an honest empty array when nothing clears the threshold", () => {
    const scored: RerankedSource[] = [
      { id: "x", raw_text: "t", relevanceScore: 1, contextSummary: "s" },
      { id: "y", raw_text: "t", relevanceScore: 4, contextSummary: "s" },
    ];
    expect(filterAndRank(scored, 5)).toEqual([]);
  });

  it("does not mutate its input array", () => {
    const scored: RerankedSource[] = [
      { id: "b", raw_text: "t", relevanceScore: 3, contextSummary: "s" },
      { id: "a", raw_text: "t", relevanceScore: 9, contextSummary: "s" },
    ];
    const snapshot = scored.map((s) => s.id);
    filterAndRank(scored, 5);
    expect(scored.map((s) => s.id)).toEqual(snapshot);
  });
});

describe("contextualRerank (injected scorer) — full RCS step", () => {
  it("filters below-threshold sources and re-ranks survivors by score", async () => {
    const sources = [src("a"), src("b"), src("c"), src("d")];
    const scorer = mockScorer({
      a: { relevanceScore: 3, contextSummary: "weak" },
      b: { relevanceScore: 10, contextSummary: "strong b" },
      c: { relevanceScore: 7, contextSummary: "solid c" },
      d: { relevanceScore: 0, contextSummary: "" },
    });

    const result = await contextualRerank("does drug X reduce events?", sources, {
      scoreSource: scorer,
    });

    // a (3) and d (0) are below threshold and dropped; b (10) outranks c (7).
    expect(result.map((r) => r.id)).toEqual(["b", "c"]);
    expect(result[0].contextSummary).toBe("strong b");
    expect(result[0].relevanceScore).toBe(10);
    // Original raw_text is carried through for downstream grounding.
    expect(result[0].raw_text).toBe("text-b");
  });

  it("returns empty when no source clears the threshold (refuse-when-none)", async () => {
    const sources = [src("a"), src("b")];
    const scorer = mockScorer({
      a: { relevanceScore: 2, contextSummary: "meh" },
      b: { relevanceScore: 4, contextSummary: "meh" },
    });
    const result = await contextualRerank("unrelated question", sources, {
      scoreSource: scorer,
    });
    expect(result).toEqual([]);
  });

  it("uses the documented default threshold when none is provided", async () => {
    const sources = [src("keep"), src("drop")];
    const scorer = mockScorer({
      keep: { relevanceScore: RELEVANCE_THRESHOLD, contextSummary: "ok" },
      drop: { relevanceScore: RELEVANCE_THRESHOLD - 1, contextSummary: "no" },
    });
    const result = await contextualRerank("q", sources, { scoreSource: scorer });
    expect(result.map((r) => r.id)).toEqual(["keep"]);
  });

  it("honors a custom threshold override", async () => {
    const sources = [src("a"), src("b")];
    const scorer = mockScorer({
      a: { relevanceScore: 8, contextSummary: "a" },
      b: { relevanceScore: 9, contextSummary: "b" },
    });
    const strict = await contextualRerank("q", sources, {
      scoreSource: scorer,
      threshold: 9,
    });
    expect(strict.map((r) => r.id)).toEqual(["b"]);
  });

  it("treats a scorer failure as not-applicable (score 0) rather than throwing", async () => {
    const sources = [src("good"), src("boom")];
    const scorer: ContextScorer = async (_q, source) => {
      if (source.id === "boom") throw new Error("model error");
      return { relevanceScore: 8, contextSummary: "good" };
    };
    const result = await contextualRerank("q", sources, { scoreSource: scorer });
    // The failed source is dropped (treated as score 0); the good one survives.
    expect(result.map((r) => r.id)).toEqual(["good"]);
  });

  it("returns empty for an empty source list without calling the scorer", async () => {
    let called = false;
    const scorer: ContextScorer = async () => {
      called = true;
      return { relevanceScore: 10, contextSummary: "x" };
    };
    const result = await contextualRerank("q", [], { scoreSource: scorer });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it("rejects an empty query", async () => {
    await expect(
      contextualRerank("   ", [src("a")], { scoreSource: mockScorer({}) })
    ).rejects.toThrow(/non-empty/);
  });
});
