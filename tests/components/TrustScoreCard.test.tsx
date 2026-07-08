import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TrustScoreCard } from "../../components/TrustScoreCard";

afterEach(cleanup);

describe("TrustScoreCard", () => {
  it("renders the score, trust-band label, and discrepancy label", () => {
    render(
      <TrustScoreCard
        trustScore={95}
        discrepancyType="accurate"
        explanation="The claim matches the source finding."
      />,
    );

    // Score
    expect(screen.getByText("95")).toBeInTheDocument();
    // Trust-band label (>=90 => "Likely accurate")
    expect(screen.getByText("Likely accurate")).toBeInTheDocument();
    // Discrepancy label
    expect(screen.getByText("Accurate")).toBeInTheDocument();
    // Explanation
    expect(
      screen.getByText("The claim matches the source finding."),
    ).toBeInTheDocument();
  });

  it("renders the moderate band label and a mapped discrepancy label", () => {
    render(
      <TrustScoreCard
        trustScore={72}
        discrepancyType="magnitude_overstated"
        explanation="The claimed magnitude is larger than the source reports."
      />,
    );

    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("Minor drift")).toBeInTheDocument();
    expect(screen.getByText("Magnitude overstated")).toBeInTheDocument();
  });

  it("falls back to the raw discrepancy type when unmapped", () => {
    render(
      <TrustScoreCard
        trustScore={40}
        discrepancyType="some_unknown_type"
        explanation="Low trust."
      />,
    );

    expect(screen.getByText("Significant drift")).toBeInTheDocument();
    expect(screen.getByText("some_unknown_type")).toBeInTheDocument();
  });
});
