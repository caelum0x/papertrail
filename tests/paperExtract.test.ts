import { describe, it, expect } from "vitest";
import { groundEffects } from "../lib/extraction/paperExtract";
import type { ExtractedEffect } from "../lib/extraction/schemas";

// Oracle test for the structured-extraction TRUST LAYER: no DB, no LLM. It proves
// the invariant that makes heavy full-paper Claude use safe — an effect whose quote
// is a real substring of the source survives (with correct offsets) and gets its
// number deterministically reconciled, while an effect whose quote is fabricated is
// DROPPED. No unsourced number ever reaches the caller.

const RAW =
  "The primary endpoint occurred in 9.4% of the treatment group and 12.5% of the " +
  "placebo group (hazard ratio 0.74; 95% CI, 0.63 to 0.87; P<0.001), corresponding " +
  "to a 26% relative risk reduction. All-cause mortality did not differ (HR 0.92; 95% CI, 0.79 to 1.08).";

function effect(over: Partial<ExtractedEffect>): ExtractedEffect {
  return {
    endpoint: "primary composite",
    measure: "HR",
    point: 0.74,
    ci_low: 0.63,
    ci_high: 0.87,
    is_percent: false,
    quote: "hazard ratio 0.74; 95% CI, 0.63 to 0.87",
    ...over,
  };
}

describe("groundEffects — grounding invariant", () => {
  it("drops an effect whose quote is not a substring of the source", () => {
    const fabricated = effect({
      point: 0.5,
      quote: "hazard ratio 0.50 for the fabricated endpoint",
    });
    const { effects, droppedCount } = groundEffects([fabricated], RAW);
    expect(effects).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });

  it("keeps a verbatim effect with offsets that slice back to the located quote", () => {
    const { effects, droppedCount } = groundEffects([effect({})], RAW);
    expect(droppedCount).toBe(0);
    expect(effects).toHaveLength(1);
    const kept = effects[0];
    // The stored quote is the VERBATIM located substring, and the offsets prove it.
    expect(RAW.slice(kept.grounding.start, kept.grounding.end)).toBe(kept.quote);
    expect(kept.quote).toContain("hazard ratio 0.74");
  });
});

describe("groundEffects — deterministic number reconciliation", () => {
  it("CONFIRMS a number that the deterministic parser re-reads from the grounded quote", () => {
    const { effects } = groundEffects([effect({})], RAW);
    const kept = effects[0];
    expect(kept.reconciliation).toBe("confirmed");
    expect(kept.parsed_point).toBe(0.74);
  });

  it("flags a MISMATCH when Claude's number disagrees with the grounded quote", () => {
    // The quote is real (grounds fine), but Claude's reported point (0.55) does not
    // match the number the deterministic parser reads from that same quote (0.74).
    const lying = effect({ point: 0.55 });
    const { effects } = groundEffects([lying], RAW);
    expect(effects).toHaveLength(1);
    expect(effects[0].reconciliation).toBe("mismatch");
    expect(effects[0].parsed_point).toBe(0.74);
  });

  it("marks UNVERIFIED when the grounded quote has no re-parseable number", () => {
    const prose = effect({
      measure: "unknown",
      point: null,
      ci_low: null,
      ci_high: null,
      quote: "of the treatment group and 12.5% of the",
    });
    const { effects } = groundEffects([prose], RAW);
    expect(effects).toHaveLength(1);
    expect(effects[0].reconciliation).toBe("unverified");
  });
});
