import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VerifyStepper } from "../../components/VerifyStepper";

afterEach(cleanup);

describe("VerifyStepper", () => {
  it("renders all stage labels", () => {
    render(<VerifyStepper />);

    expect(screen.getByText("Matching primary source")).toBeInTheDocument();
    expect(screen.getByText("Extracting the finding")).toBeInTheDocument();
    expect(screen.getByText("Comparing claim vs source")).toBeInTheDocument();
    expect(screen.getByText("Grounding every quote")).toBeInTheDocument();
  });

  it("renders an accessible progress list", () => {
    render(<VerifyStepper />);
    expect(
      screen.getByRole("list", { name: "Verification progress" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
