import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FindingCard } from "../../components/FindingCard";
import type { ExtractedFinding } from "../../lib/schemas";

afterEach(cleanup);

const finding: ExtractedFinding = {
  effect_size: "18% relative risk reduction",
  population: "adults 65+ with prior MI",
  condition: "cardiovascular disease",
  endpoint: "major adverse cardiovascular events at 24 months",
  caveats: ["Open-label extension phase", "Excluded patients with renal impairment"],
};

describe("FindingCard", () => {
  it("renders effect size, population, condition, and endpoint values", () => {
    render(<FindingCard finding={finding} />);

    expect(screen.getByText("18% relative risk reduction")).toBeInTheDocument();
    expect(screen.getByText("adults 65+ with prior MI")).toBeInTheDocument();
    expect(screen.getByText("cardiovascular disease")).toBeInTheDocument();
    expect(
      screen.getByText("major adverse cardiovascular events at 24 months"),
    ).toBeInTheDocument();
  });

  it("renders the field labels", () => {
    render(<FindingCard finding={finding} />);
    expect(screen.getByText("Effect size")).toBeInTheDocument();
    expect(screen.getByText("Population")).toBeInTheDocument();
    expect(screen.getByText("Condition")).toBeInTheDocument();
    expect(screen.getByText("Endpoint")).toBeInTheDocument();
    expect(screen.getByText("Caveats")).toBeInTheDocument();
  });

  it("renders each caveat as a list item", () => {
    render(<FindingCard finding={finding} />);
    expect(screen.getByText("Open-label extension phase")).toBeInTheDocument();
    expect(
      screen.getByText("Excluded patients with renal impairment"),
    ).toBeInTheDocument();
  });

  it("shows 'None reported' when there are no caveats", () => {
    render(<FindingCard finding={{ ...finding, caveats: [] }} />);
    expect(screen.getByText("None reported")).toBeInTheDocument();
  });

  it("shows 'Not reported' for unreported fields", () => {
    render(
      <FindingCard finding={{ ...finding, effect_size: "not reported" }} />,
    );
    expect(screen.getByText("Not reported")).toBeInTheDocument();
  });
});
