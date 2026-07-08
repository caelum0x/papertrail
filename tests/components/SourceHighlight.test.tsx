import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SourceHighlight } from "../../components/SourceHighlight";
import type { GroundedSpan } from "../../lib/grounding";

afterEach(cleanup);

const rawText =
  "The trial showed an 18% relative risk reduction in adults 65+ with prior MI.";

// Offsets computed against rawText so the <mark> slices to the exact span text.
const spanText = "18% relative risk reduction";
const start = rawText.indexOf(spanText);
const end = start + spanText.length;

const spans: GroundedSpan[] = [
  {
    claim_span: "reduced events by 30%",
    source_span: spanText,
    issue: "Claimed magnitude exceeds the source.",
    grounding: { status: "exact", start, end },
  },
];

describe("SourceHighlight", () => {
  it("renders a <mark> containing the grounded span text", () => {
    render(<SourceHighlight rawText={rawText} spans={spans} />);

    const mark = screen.getByText(spanText);
    expect(mark).toBeInTheDocument();
    expect(mark.tagName).toBe("MARK");
  });

  it("gives the mark an id derived from idPrefix and the span index", () => {
    render(<SourceHighlight rawText={rawText} spans={spans} idPrefix="hl" />);
    const mark = screen.getByText(spanText);
    expect(mark).toHaveAttribute("id", "hl-0");
  });

  it("exposes the span issue as the mark title", () => {
    render(<SourceHighlight rawText={rawText} spans={spans} />);
    expect(screen.getByText(spanText)).toHaveAttribute(
      "title",
      "Claimed magnitude exceeds the source.",
    );
  });

  it("renders no <mark> when there are no spans", () => {
    const { container } = render(
      <SourceHighlight rawText={rawText} spans={[]} />,
    );
    expect(container.querySelector("mark")).toBeNull();
  });
});
