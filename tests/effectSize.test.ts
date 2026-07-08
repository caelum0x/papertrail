import { describe, it, expect } from "vitest";
import { parseEffectSizes, reconcile } from "../lib/effectSize";

describe("parseEffectSizes", () => {
  it("extracts an HR point estimate and CI from NEJM-style phrasing", () => {
    const effects = parseEffectSizes("hazard ratio, 0.75; 95% CI, 0.64 to 0.89");
    const hr = effects.find((e) => e.measure === "HR");
    expect(hr).toBeDefined();
    expect(hr!.point).toBe(0.75);
    expect(hr!.ciLow).toBe(0.64);
    expect(hr!.ciHigh).toBe(0.89);
    expect(hr!.isPercent).toBe(false);
  });

  it("extracts an HR + CI from parenthetical hyphen-CI phrasing", () => {
    const effects = parseEffectSizes("HR 0.75 (95% CI 0.64-0.89)");
    const hr = effects.find((e) => e.measure === "HR");
    expect(hr).toBeDefined();
    expect(hr!.point).toBe(0.75);
    expect(hr!.ciLow).toBe(0.64);
    expect(hr!.ciHigh).toBe(0.89);
  });

  it("extracts a 27% relative risk reduction and keeps isPercent", () => {
    const effects = parseEffectSizes("relative risk reduction of 27%");
    const rrr = effects.find((e) => e.measure === "RRR");
    expect(rrr).toBeDefined();
    expect(rrr!.point).toBe(27);
    expect(rrr!.isPercent).toBe(true);
  });

  it("extracts an odds ratio with a bare parenthetical CI", () => {
    const effects = parseEffectSizes("odds ratio 1.8 (1.2-2.7)");
    const or = effects.find((e) => e.measure === "OR");
    expect(or).toBeDefined();
    expect(or!.point).toBe(1.8);
    expect(or!.ciLow).toBe(1.2);
    expect(or!.ciHigh).toBe(2.7);
  });

  it("extracts an absolute effect in points", () => {
    const effects = parseEffectSizes("reduced decline by 0.45 points versus placebo");
    const abs = effects.find((e) => e.measure === "absolute");
    expect(abs).toBeDefined();
    expect(abs!.point).toBe(0.45);
    expect(abs!.isPercent).toBe(false);
  });
});

describe("reconcile", () => {
  it("flags caveat_dropped when the source CI crosses the null", () => {
    const r = reconcile(
      "The drug significantly reduced cardiovascular events.",
      "The primary endpoint showed HR 0.90 (95% CI 0.78 to 1.04)."
    );
    expect(r.verdict).toBe("caveat_dropped");
    expect(r.sourceEffect!.measure).toBe("HR");
    expect(r.rationale).toContain("1.04");
  });

  it("flags magnitude_overstated when the claim cuts risk in half vs an 18% RRR source", () => {
    const r = reconcile(
      "The drug cuts cardiovascular risk in half.",
      "The trial showed a relative risk reduction of 18%."
    );
    expect(r.verdict).toBe("magnitude_overstated");
    expect(r.claimedValue).toBe(50);
    expect(r.sourceEffect!.measure).toBe("RRR");
  });

  it("returns consistent when the claim matches an RRR source", () => {
    const r = reconcile(
      "The treatment reduced events by about 25%.",
      "The trial reported a relative risk reduction of 25%."
    );
    expect(r.verdict).toBe("consistent");
    expect(r.claimedValue).toBe(25);
  });

  it("returns consistent when a ~25% claim matches an HR 0.75 source", () => {
    const r = reconcile(
      "The treatment reduced events by about 25%.",
      "The primary endpoint was HR 0.75 (95% CI 0.64 to 0.89)."
    );
    expect(r.verdict).toBe("consistent");
    expect(r.sourceEffect!.measure).toBe("HR");
  });

  it("cannot_reconcile when the source has no parseable numbers", () => {
    const r = reconcile(
      "The drug reduced events by 30%.",
      "The trial showed a meaningful benefit on the primary endpoint."
    );
    expect(r.verdict).toBe("cannot_reconcile");
    expect(r.sourceEffect).toBeNull();
  });

  it("cannot_reconcile when a relative % claim faces an absolute-points source", () => {
    const r = reconcile(
      "The drug reduced risk by 40%.",
      "Lecanemab reduced decline on the CDR-SB by 0.45 points versus placebo."
    );
    expect(r.verdict).toBe("cannot_reconcile");
    expect(r.sourceEffect!.measure).toBe("absolute");
  });

  // Regression: real SPRINT phrasing has connector words between "hazard ratio" and 0.75,
  // and "hazard ratio of 0.75" in the claim — both were previously missed (cannot_reconcile).
  it("is consistent for real SPRINT phrasing with words between label and estimate", () => {
    const r = reconcile(
      "reduced the primary composite cardiovascular outcome, with a hazard ratio of 0.75",
      "hazard ratio with intensive treatment, 0.75; 95% CI, 0.64 to 0.89"
    );
    expect(r.verdict).toBe("consistent");
    expect(r.sourceEffect!.point).toBe(0.75);
  });

  // Regression: the ratio parser must NOT truncate "27%" into a spurious ratio of 2/27.
  it("does not misparse 'relative risk reduction of 27%' as a ratio measure", () => {
    const effects = parseEffectSizes("relative risk reduction of 27%");
    expect(effects.some((e) => ["HR", "RR", "OR"].includes(e.measure))).toBe(false);
    expect(effects.find((e) => e.measure === "RRR")!.point).toBe(27);
  });
});
