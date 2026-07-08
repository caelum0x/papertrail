import { describe, it, expect } from "vitest";
import {
  trustBand,
  trustBandLabel,
  trustBandClasses,
  type TrustBand,
} from "../lib/trustBand";

describe("trustBand", () => {
  it("bands the low boundary 0 as low", () => {
    expect(trustBand(0)).toBe("low");
  });

  it("bands 59 (just below the moderate cutoff) as low", () => {
    expect(trustBand(59)).toBe("low");
  });

  it("bands exactly 60 as moderate", () => {
    expect(trustBand(60)).toBe("moderate");
  });

  it("bands 89 (just below the high cutoff) as moderate", () => {
    expect(trustBand(89)).toBe("moderate");
  });

  it("bands exactly 90 as high", () => {
    expect(trustBand(90)).toBe("high");
  });

  it("bands the top boundary 100 as high", () => {
    expect(trustBand(100)).toBe("high");
  });

  it("clamps scores above 100 into high", () => {
    expect(trustBand(120)).toBe("high");
    expect(trustBand(Number.MAX_SAFE_INTEGER)).toBe("high");
  });

  it("clamps negative scores into low", () => {
    expect(trustBand(-1)).toBe("low");
    expect(trustBand(-1000)).toBe("low");
  });

  it("treats NaN defensively as low", () => {
    expect(trustBand(Number.NaN)).toBe("low");
  });
});

describe("trustBandLabel", () => {
  it("maps every band to its user-facing label", () => {
    expect(trustBandLabel("high")).toBe("Likely accurate");
    expect(trustBandLabel("moderate")).toBe("Minor drift");
    expect(trustBandLabel("low")).toBe("Significant drift");
  });
});

describe("trustBandClasses", () => {
  const bands: TrustBand[] = ["high", "moderate", "low"];

  it("returns background, text, and border classes for every band", () => {
    for (const band of bands) {
      const classes = trustBandClasses(band);
      expect(classes).toMatch(/\bbg-/);
      expect(classes).toMatch(/\btext-/);
      expect(classes).toMatch(/\bborder-/);
    }
  });

  it("uses distinct color families per band (green/yellow/red)", () => {
    expect(trustBandClasses("high")).toContain("green");
    expect(trustBandClasses("moderate")).toContain("yellow");
    expect(trustBandClasses("low")).toContain("red");
  });
});
