import { describe, it, expect } from "vitest";
import {
  verifyAgainstSynthesis,
  buildSynthesisInputs,
  type SynthesisSource,
} from "../lib/synthesisVerification";
import type { TrialResultAnalysis } from "../lib/sources/clinicaltrials";

// Build a minimal registered-results analysis for a trial reporting one ratio outcome.
function analysis(
  paramType: string,
  paramValue: number,
  ciLower: number,
  ciUpper: number,
  outcomeType = "PRIMARY"
): TrialResultAnalysis {
  return {
    outcomeTitle: "Primary composite endpoint",
    outcomeType,
    paramType,
    paramValue,
    ciPct: 95,
    ciLower,
    ciUpper,
    pValue: null,
    method: null,
  };
}

function source(label: string, a: TrialResultAnalysis): SynthesisSource {
  return { label, analyses: [a] };
}

// Three HR trials with modest, consistent benefits pooling to ~HR 0.80 (~20% reduction).
const CONSISTENT: SynthesisSource[] = [
  source("SPRINT", analysis("Hazard Ratio (HR)", 0.75, 0.64, 0.89)),
  source("HOPE-3", analysis("Hazard Ratio (HR)", 0.82, 0.7, 0.96)),
  source("ASCOT", analysis("Hazard Ratio (HR)", 0.84, 0.72, 0.98)),
];

describe("verifyAgainstSynthesis — magnitude vs the pooled totality", () => {
  it("flags a 'cut risk in half' claim as overstating the pooled ~20% reduction", () => {
    const r = verifyAgainstSynthesis("The drug cut cardiovascular risk in half.", CONSISTENT);
    expect(["overstates_pooled", "single_trial_cherry_pick"]).toContain(r.verdict);
    expect(r.pooledReductionPercent).toBeGreaterThan(10);
    expect(r.pooledReductionPercent).toBeLessThan(30);
    expect(r.pooled).not.toBeNull();
    expect(r.pooled!.k).toBe(3);
  });

  it("accepts a claim whose magnitude matches the pooled estimate", () => {
    const r = verifyAgainstSynthesis(
      "Across trials, the drug reduced events by about 20%.",
      CONSISTENT
    );
    expect(r.verdict).toBe("matches_pooled");
    expect(r.claimedReductionPercent).toBeCloseTo(20, 0);
  });

  it("detects single-trial cherry-picking when the claim matches only the best trial", () => {
    // One strongly-positive trial + several modest-but-significant trials. The
    // pool IS significant (so significance is not the issue), but a 40% claim
    // matches only the outlier and overstates the pooled ~15-20% reduction.
    const cherry: SynthesisSource[] = [
      source("Outlier", analysis("Risk Ratio (RR)", 0.6, 0.45, 0.8)),
      source("Modest-1", analysis("Risk Ratio (RR)", 0.86, 0.76, 0.97)),
      source("Modest-2", analysis("Risk Ratio (RR)", 0.87, 0.77, 0.98)),
      source("Modest-3", analysis("Risk Ratio (RR)", 0.85, 0.75, 0.96)),
    ];
    const r = verifyAgainstSynthesis("The therapy reduces events by 40%.", cherry);
    expect(r.verdict).toBe("single_trial_cherry_pick");
    expect(r.rationale).toMatch(/Outlier/);
  });

  it("flags a benefit claim when the pooled CI crosses the null", () => {
    const nullish: SynthesisSource[] = [
      source("N1", analysis("Risk Ratio (RR)", 0.98, 0.85, 1.13)),
      source("N2", analysis("Risk Ratio (RR)", 1.01, 0.9, 1.14)),
    ];
    const r = verifyAgainstSynthesis("The drug significantly reduces mortality.", nullish);
    expect(r.verdict).toBe("significance_mismatch");
    expect(r.pooled!.random.significant).toBe(false);
  });

  it("cautions when trials are considerably heterogeneous (I² ≥ 75)", () => {
    // Two clearly-protective trials of very different magnitude with tight CIs →
    // high I², but the pool stays significant (both < 1). A ~25% claim sits near
    // the pooled point, yet the between-trial inconsistency should be flagged.
    const hetero: SynthesisSource[] = [
      source("Strong", analysis("Risk Ratio (RR)", 0.7, 0.66, 0.74)),
      source("Modest", analysis("Risk Ratio (RR)", 0.82, 0.78, 0.86)),
    ];
    const r = verifyAgainstSynthesis("The drug reduces events by about 25%.", hetero);
    expect(r.pooled!.heterogeneity.iSquared).toBeGreaterThanOrEqual(75);
    expect(r.verdict).toBe("high_heterogeneity");
  });

  it("returns insufficient_evidence with fewer than two poolable trials", () => {
    const one = [source("Solo", analysis("Hazard Ratio (HR)", 0.75, 0.64, 0.89))];
    const r = verifyAgainstSynthesis("The drug halves risk.", one);
    expect(r.verdict).toBe("insufficient_evidence");
    expect(r.pooled).toBeNull();
  });
});

describe("buildSynthesisInputs — measure selection", () => {
  it("chooses the dominant measure and drops off-measure trials", () => {
    const mixed: SynthesisSource[] = [
      source("A", analysis("Hazard Ratio (HR)", 0.75, 0.64, 0.89)),
      source("B", analysis("Hazard Ratio (HR)", 0.8, 0.7, 0.92)),
      source("C", analysis("Odds Ratio (OR)", 0.5, 0.3, 0.83)),
    ];
    const { measure, inputs } = buildSynthesisInputs(mixed);
    expect(measure).toBe("HR");
    expect(inputs).toHaveLength(2);
  });

  it("prefers the PRIMARY analysis within a source", () => {
    const s: SynthesisSource = {
      label: "MultiOutcome",
      analyses: [
        analysis("Hazard Ratio (HR)", 0.6, 0.4, 0.9, "SECONDARY"),
        analysis("Hazard Ratio (HR)", 0.85, 0.74, 0.98, "PRIMARY"),
      ],
    };
    const { inputs } = buildSynthesisInputs([s, source("B", analysis("Hazard Ratio (HR)", 0.82, 0.7, 0.96))]);
    expect(inputs[0].point).toBe(0.85);
  });
});
