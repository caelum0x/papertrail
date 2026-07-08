import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CitationTrail } from "../../components/CitationTrail";

afterEach(cleanup);

const spans = [
  {
    claim_span: "reduced events by 30%",
    source_span: "18% relative risk reduction",
    issue: "Claimed magnitude exceeds the source.",
  },
  {
    claim_span: "in all adults",
    source_span: "adults 65+ with prior MI",
    issue: "Population overgeneralized.",
  },
];

describe("CitationTrail", () => {
  it("renders each flagged span's claim and source text", () => {
    render(<CitationTrail flaggedSpans={spans} />);

    expect(screen.getByText(/reduced events by 30%/)).toBeInTheDocument();
    expect(screen.getByText(/18% relative risk reduction/)).toBeInTheDocument();
    expect(screen.getByText(/in all adults/)).toBeInTheDocument();
    expect(screen.getByText(/adults 65\+ with prior MI/)).toBeInTheDocument();
    expect(
      screen.getByText("Claimed magnitude exceeds the source."),
    ).toBeInTheDocument();
    expect(screen.getByText("Population overgeneralized.")).toBeInTheDocument();
  });

  it("renders an empty-state message when there are no flagged spans", () => {
    render(<CitationTrail flaggedSpans={[]} />);
    expect(
      screen.getByText(/No specific discrepancies flagged/),
    ).toBeInTheDocument();
  });

  it("is non-interactive (no buttons) when spanIdPrefix is not set", () => {
    render(<CitationTrail flaggedSpans={spans} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText(/Click to locate in source/)).toBeNull();
  });

  it("renders each flag as a button and shows the locate hint when spanIdPrefix is set", () => {
    render(<CitationTrail flaggedSpans={spans} spanIdPrefix="span" />);

    expect(screen.getAllByRole("button")).toHaveLength(spans.length);
    expect(screen.getAllByText(/Click to locate in source/)).toHaveLength(
      spans.length,
    );
  });
});
