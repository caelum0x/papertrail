import { describe, it, expect } from "vitest";
import { fragilityIndex } from "../lib/evidenceFragility";

// Regression coverage for the fragility-index DIRECTION fix. The prior implementation only
// added events to the fewer-RAW-event arm, so a significant table whose fewer-event arm has
// the HIGHER event rate (a small imbalanced / harmful-treatment arm) could never be flipped
// and was mislabeled "robust" (fragilityIndex: null) — the exact opposite of the truth. The
// search now tries all four within-arm reassignments and takes the true minimum.
describe("fragilityIndex — direction correctness", () => {
  it("computes the standard-orientation FI unchanged", () => {
    const r = fragilityIndex({ a: 10, b: 90, c: 25, d: 75 });
    expect(r.fragilityIndex).toBe(4);
    expect(r.baselineP).toBeLessThan(0.05);
    expect(r.flippedP).not.toBeNull();
    expect(r.flippedP!).toBeGreaterThanOrEqual(0.05);
  });

  it("finds the fragility index of an imbalanced table (was mislabeled robust)", () => {
    // a=8 events / arm1 of 10 (rate 0.80) vs c=9 / arm2 of 90 (rate 0.10): the fewer-RAW-event
    // arm (arm1, 8 events) has the HIGHER rate, so the old add-events search never flipped it.
    const r = fragilityIndex({ a: 8, b: 2, c: 9, d: 81 });
    expect(r.baselineP).toBeLessThan(0.05);
    expect(r.fragilityIndex).toBe(5);
    expect(r.verdict).not.toBe("robust");
    expect(r.flippedP!).toBeGreaterThanOrEqual(0.05);
  });

  it("flags a genuinely fragile imbalanced table (FI = 2), not 'highly robust'", () => {
    const r = fragilityIndex({ a: 3, b: 5, c: 5, d: 195 });
    expect(r.baselineP).toBeLessThan(0.05);
    expect(r.fragilityIndex).toBe(2);
    expect(r.verdict).toBe("fragile");
  });
});
