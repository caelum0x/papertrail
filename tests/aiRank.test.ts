import { describe, it, expect } from "vitest";
import { isRationaleGrounded } from "../lib/screening/aiRank";

// Oracle test for the SCREENING TRUST LAYER: the deterministic grounding check that
// verifies a Claude-produced rationale actually describes the record's own abstract.
// No Claude, no DB, no network — pure content-word overlap. This is the guarantee
// that lets us rank at scale with Claude: a fabricated rationale is flagged, never
// silently trusted.

const record = {
  title: "Empagliflozin in heart failure with preserved ejection fraction",
  abstract:
    "In a randomized trial of adults with heart failure and preserved ejection " +
    "fraction, empagliflozin reduced hospitalization for heart failure over 26 months.",
};

describe("isRationaleGrounded", () => {
  it("accepts a rationale whose content words come from the abstract", () => {
    const grounded = isRationaleGrounded(
      "Randomized trial of empagliflozin in heart failure with preserved ejection fraction.",
      record
    );
    expect(grounded).toBe(true);
  });

  it("rejects a rationale that describes content not in the abstract", () => {
    const grounded = isRationaleGrounded(
      "Observational cohort of pediatric asthma inhaler adherence in urban clinics.",
      record
    );
    expect(grounded).toBe(false);
  });

  it("rejects an empty rationale", () => {
    expect(isRationaleGrounded("   ", record)).toBe(false);
  });

  it("does not count only stop-word overlap as grounded", () => {
    // Shares only 'the/of/was/and'-class words with the source — no real signal.
    const grounded = isRationaleGrounded(
      "The results of the study were the same and this was for the patients.",
      record
    );
    expect(grounded).toBe(false);
  });

  it("can ground a title-only record against its title", () => {
    const titleOnly = { title: "Empagliflozin cardiovascular outcomes trial", abstract: null };
    expect(
      isRationaleGrounded("Empagliflozin cardiovascular outcomes trial.", titleOnly)
    ).toBe(true);
  });
});
