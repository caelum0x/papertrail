import { describe, it, expect } from "vitest";
import { stageForElapsed } from "../components/VerifyStepper";

describe("stageForElapsed", () => {
  it("returns stage 0 at zero elapsed time", () => {
    expect(stageForElapsed(0, 4)).toBe(0);
  });

  it("returns stage 0 for negative elapsed time", () => {
    expect(stageForElapsed(-500, 4)).toBe(0);
  });

  it("advances to the correct index mid-progress", () => {
    // At the default 1600ms interval, ~3.3s in is stage 2.
    expect(stageForElapsed(3300, 4)).toBe(2);
    // Just under the second interval boundary is still stage 0.
    expect(stageForElapsed(1599, 4)).toBe(0);
    // Exactly one interval elapsed advances to stage 1.
    expect(stageForElapsed(1600, 4)).toBe(1);
  });

  it("respects a custom interval", () => {
    expect(stageForElapsed(2500, 4, 1000)).toBe(2);
  });

  it("caps at count - 1 for huge elapsed times", () => {
    expect(stageForElapsed(1_000_000, 4)).toBe(3);
  });

  it("returns 0 for a non-positive count", () => {
    expect(stageForElapsed(5000, 0)).toBe(0);
  });
});
