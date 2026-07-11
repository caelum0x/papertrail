import { describe, it, expect } from "vitest";
import { detectPolarity } from "@/lib/grounding/negationEntailment";

// detectPolarity is a deterministic multiplier on the final support/refute label, so a wrong
// polarity INVERTS the verdict. These cases pin the two verdict-inverting bugs a biostatistics
// audit found (double negation, scoped negation) plus lexicon coverage.
describe("detectPolarity — parity + scope", () => {
  it("classifies a plain benefit claim positive", () => {
    expect(detectPolarity("Drug X reduced mortality by 30%").polarity).toBe("positive");
  });

  it("classifies a single negation negative (overlapping cues merge to one)", () => {
    expect(detectPolarity("The drug did not reduce mortality").polarity).toBe("negative");
    expect(detectPolarity("does not cause harm").polarity).toBe("negative");
    expect(detectPolarity("There was no significant difference").polarity).toBe("negative");
  });

  it("cancels a DOUBLE negation to positive (was inverted to a false refute)", () => {
    expect(detectPolarity("The therapy was not without benefit").polarity).toBe("positive");
  });

  it("scopes a negation to its secondary clause, keeping the primary polarity", () => {
    // "not" denies blood pressure only; the primary assertion (reduced mortality) is positive.
    expect(
      detectPolarity("Drug X reduced mortality but not blood pressure").polarity
    ).toBe("positive");
  });

  it("covers lexicon gaps that previously read as positive", () => {
    expect(detectPolarity("The effect was negligible").polarity).toBe("negative");
    expect(detectPolarity("The trial ruled out any survival benefit").polarity).toBe("negative");
  });
});
