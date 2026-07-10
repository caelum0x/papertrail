import { describe, it, expect } from "vitest";

// Oracle tests for the Valsci port (lib/scieval/valsci.ts). The ONLY non-deterministic step
// is per-source scoring, which we inject via `deps.scoreSource` (a plain async stub — no
// @/lib/claude, no network, no API key). Everything asserted here is the deterministic
// machinery that makes the claim-level verdict trustworthy:
//   (1) Relevance-weighted aggregation: high-relevance sources dominate the claim-level score,
//       and the classification thresholds map that score to supported | mixed | refuted.
//   (2) Relevance floor: a source scored below 0.1 is dropped (Valsci's relevance>=0.1 gate)
//       and does NOT contribute to the score or the surviving-source list.
//   (3) Grounding drop: a source whose quoted span is not a verbatim substring of raw_text is
//       dropped from aggregation and counted in grounding_dropped_count — never cited.
//   (4) Grounded spans carry the VERBATIM located text + correct char offsets, not the stub's copy.
//   (5) No surviving evidence => "insufficient".
//   (6) classify / aggregate pure-function behavior at the thresholds.

import {
  scoreClaim,
  aggregate,
  classify,
  RELEVANCE_FLOOR,
  SUPPORT_THRESHOLD,
  type ScoreClaimInput,
  type SourceScorer,
  type ValsciSourceInput,
  type ValsciSourceScore,
} from "@/lib/scieval/valsci";

const ABSTRACT_A =
  "This randomized trial enrolled 4200 adults with prior myocardial infarction. Drug X reduced major adverse cardiovascular events by 30% compared with placebo over 24 months. No significant reduction was seen in all-cause mortality.";

const ABSTRACT_B =
  "In a separate cohort, Drug X showed no benefit on cardiovascular events and was associated with more adverse effects than placebo.";

const CLAIM = "Drug X reduced cardiovascular events by 30%.";

function source(external_id: string, raw_text: string, title?: string): ValsciSourceInput {
  return { source_type: "pubmed", external_id, raw_text, title, url: `https://example.org/${external_id}` };
}

// Build a stub scorer that returns a fixed raw score per external_id.
function stubScorer(byId: Record<string, { relevance: number; support: number; span: string; rationale: string }>): SourceScorer {
  return async (_claim, s) => {
    const hit = byId[s.external_id];
    if (!hit) throw new Error(`no stub for ${s.external_id}`);
    return hit;
  };
}

describe("scoreClaim — relevance-weighted aggregation + classification", () => {
  it("classifies as supported when the dominant, most-relevant source supports the claim", async () => {
    const input: ScoreClaimInput = {
      claim: CLAIM,
      sources: [source("A", ABSTRACT_A)],
    };
    const scorer = stubScorer({
      A: {
        relevance: 0.95,
        support: 0.9,
        span: "Drug X reduced major adverse cardiovascular events by 30% compared with placebo over 24 months.",
        rationale: "Directly reports the 30% reduction the claim asserts.",
      },
    });

    const result = await scoreClaim(input, { scoreSource: scorer });

    expect(result.verdict).toBe("supported");
    expect(result.score).toBeGreaterThanOrEqual(SUPPORT_THRESHOLD);
    expect(result.scored_count).toBe(1);
    expect(result.considered_count).toBe(1);
  });

  it("weights support by relevance — a high-relevance refuter outweighs a low-relevance supporter", async () => {
    const input: ScoreClaimInput = {
      claim: CLAIM,
      sources: [source("A", ABSTRACT_A), source("B", ABSTRACT_B)],
    };
    // A supports (+0.8) but is only mildly relevant (0.2); B refutes (-0.9) and is highly relevant (0.9).
    // Weighted mean = (0.2*0.8 + 0.9*-0.9) / (0.2 + 0.9) = (0.16 - 0.81) / 1.1 = -0.5909...
    const scorer = stubScorer({
      A: { relevance: 0.2, support: 0.8, span: "Drug X reduced major adverse cardiovascular events by 30% compared with placebo over 24 months.", rationale: "Weakly on point." },
      B: { relevance: 0.9, support: -0.9, span: "Drug X showed no benefit on cardiovascular events and was associated with more adverse effects than placebo.", rationale: "Directly contradicts." },
    });

    const result = await scoreClaim(input, { scoreSource: scorer });

    expect(result.score).toBeCloseTo(-0.5909, 3);
    expect(result.verdict).toBe("refuted");
    expect(result.scored_count).toBe(2);
  });

  it("classifies as mixed when weighted support sits between the thresholds", async () => {
    const input: ScoreClaimInput = {
      claim: CLAIM,
      sources: [source("A", ABSTRACT_A), source("B", ABSTRACT_B)],
    };
    // Equal relevance, opposite support => mean ~0 => mixed.
    const scorer = stubScorer({
      A: { relevance: 0.8, support: 0.5, span: "Drug X reduced major adverse cardiovascular events by 30% compared with placebo over 24 months.", rationale: "Supports." },
      B: { relevance: 0.8, support: -0.5, span: "Drug X showed no benefit on cardiovascular events and was associated with more adverse effects than placebo.", rationale: "Refutes." },
    });

    const result = await scoreClaim(input, { scoreSource: scorer });

    expect(result.score).toBeCloseTo(0, 6);
    expect(result.verdict).toBe("mixed");
  });
});

describe("scoreClaim — relevance floor (Valsci's relevance>=0.1 gate)", () => {
  it("drops a source scored below RELEVANCE_FLOOR and excludes it from the score", async () => {
    const input: ScoreClaimInput = {
      claim: CLAIM,
      sources: [source("A", ABSTRACT_A), source("B", ABSTRACT_B)],
    };
    const scorer = stubScorer({
      A: { relevance: 0.9, support: 0.8, span: "Drug X reduced major adverse cardiovascular events by 30% compared with placebo over 24 months.", rationale: "Supports." },
      // B is below the floor — even though it "refutes", it must not pull the score down.
      B: { relevance: RELEVANCE_FLOOR - 0.01, support: -1, span: "Drug X showed no benefit on cardiovascular events and was associated with more adverse effects than placebo.", rationale: "Off-topic." },
    });

    const result = await scoreClaim(input, { scoreSource: scorer });

    expect(result.below_floor_count).toBe(1);
    expect(result.scored_count).toBe(1);
    expect(result.sources.map((s) => s.external_id)).toEqual(["A"]);
    expect(result.verdict).toBe("supported");
  });
});

describe("scoreClaim — grounding drop (no unsourced claims about a source)", () => {
  it("drops a relevant source whose quoted span is not a verbatim substring of raw_text", async () => {
    const input: ScoreClaimInput = { claim: CLAIM, sources: [source("A", ABSTRACT_A)] };
    const scorer = stubScorer({
      A: {
        relevance: 0.95,
        support: 0.9,
        // Fabricated span — a plausible paraphrase that never appears verbatim in ABSTRACT_A.
        span: "Drug X cut heart attacks in half within one year.",
        rationale: "Claims a benefit.",
      },
    });

    const result = await scoreClaim(input, { scoreSource: scorer });

    expect(result.grounding_dropped_count).toBe(1);
    expect(result.scored_count).toBe(0);
    expect(result.sources).toEqual([]);
    // With no grounded evidence, the claim is insufficient — never asserted from an ungroundable span.
    expect(result.verdict).toBe("insufficient");
    expect(result.score).toBe(0);
  });

  it("grounds a valid span to the VERBATIM located text with correct offsets", async () => {
    const span = "Drug X reduced major adverse cardiovascular events by 30% compared with placebo over 24 months.";
    const input: ScoreClaimInput = { claim: CLAIM, sources: [source("A", ABSTRACT_A)] };
    const scorer = stubScorer({
      A: { relevance: 0.9, support: 0.9, span, rationale: "Reports the reduction." },
    });

    const result = await scoreClaim(input, { scoreSource: scorer });

    expect(result.scored_count).toBe(1);
    const grounded = result.sources[0];
    expect(grounded.span.text).toBe(span);
    // Offsets must point at the real substring in ABSTRACT_A.
    expect(ABSTRACT_A.slice(grounded.span.grounding.start, grounded.span.grounding.end)).toBe(span);
    expect(grounded.span.grounding.status).toBe("exact");
  });

  it("recovers a whitespace-varied span as verbatim source text (approximate grounding)", async () => {
    const input: ScoreClaimInput = { claim: CLAIM, sources: [source("A", ABSTRACT_A)] };
    const scorer = stubScorer({
      A: {
        relevance: 0.9,
        support: 0.9,
        // Model collapsed the spacing; grounding should still locate it and return the real text.
        span: "Drug X reduced major adverse cardiovascular   events by 30% compared with placebo over 24 months.",
        rationale: "Reports the reduction.",
      },
    });

    const result = await scoreClaim(input, { scoreSource: scorer });

    expect(result.scored_count).toBe(1);
    const grounded = result.sources[0];
    // The returned text is the verbatim source substring, not the stub's collapsed copy.
    expect(ABSTRACT_A.slice(grounded.span.grounding.start, grounded.span.grounding.end)).toBe(grounded.span.text);
    expect(grounded.span.grounding.status).toBe("approximate");
  });
});

describe("scoreClaim — no evidence", () => {
  it("returns insufficient with an empty source list", async () => {
    const result = await scoreClaim({ claim: CLAIM, sources: [] }, { scoreSource: stubScorer({}) });
    expect(result.verdict).toBe("insufficient");
    expect(result.score).toBe(0);
    expect(result.scored_count).toBe(0);
    expect(result.considered_count).toBe(0);
  });

  it("treats an empty span at high relevance as ungroundable (dropped)", async () => {
    const input: ScoreClaimInput = { claim: CLAIM, sources: [source("A", ABSTRACT_A)] };
    const scorer = stubScorer({
      A: { relevance: 0.9, support: 0.5, span: "   ", rationale: "No quotable sentence." },
    });
    const result = await scoreClaim(input, { scoreSource: scorer });
    expect(result.grounding_dropped_count).toBe(1);
    expect(result.verdict).toBe("insufficient");
  });
});

describe("aggregate / classify — pure functions", () => {
  const mk = (relevance: number, support: number): ValsciSourceScore => ({
    source_type: "pubmed",
    external_id: "x",
    title: null,
    url: null,
    relevance,
    support,
    rationale: "r",
    span: { text: "t", grounding: { status: "exact", start: 0, end: 1 } },
  });

  it("aggregate returns insufficient for an empty set", () => {
    expect(aggregate([])).toEqual({ score: 0, verdict: "insufficient" });
  });

  it("aggregate computes a relevance-weighted mean", () => {
    // (1.0*1.0 + 0.5*-1.0) / (1.0 + 0.5) = 0.5 / 1.5 = 0.3333...
    const { score, verdict } = aggregate([mk(1.0, 1.0), mk(0.5, -1.0)]);
    expect(score).toBeCloseTo(0.3333, 3);
    expect(verdict).toBe("supported");
  });

  it("aggregate falls back to an unweighted mean when all relevances are zero", () => {
    const { score } = aggregate([mk(0, 0.4), mk(0, -0.2)]);
    expect(score).toBeCloseTo(0.1, 6);
  });

  it("classify respects the symmetric thresholds", () => {
    expect(classify(SUPPORT_THRESHOLD)).toBe("supported");
    expect(classify(SUPPORT_THRESHOLD - 0.0001)).toBe("mixed");
    expect(classify(-SUPPORT_THRESHOLD)).toBe("refuted");
    expect(classify(-SUPPORT_THRESHOLD + 0.0001)).toBe("mixed");
    expect(classify(0)).toBe("mixed");
  });
});
