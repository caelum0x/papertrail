import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { NavBar } from "../../components/NavBar";

afterEach(cleanup);

describe("NavBar", () => {
  it("renders the brand and all nav links", () => {
    render(<NavBar />);

    expect(screen.getByText("PaperTrail")).toBeInTheDocument();
    for (const label of [
      "Verify",
      "Batch",
      "Compare",
      "Sources",
      "Recent",
      "Dashboard",
      "Accuracy",
      "API",
      "About",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders nav links as anchors with correct hrefs", () => {
    render(<NavBar />);
    expect(screen.getByRole("link", { name: "Verify" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Batch" })).toHaveAttribute(
      "href",
      "/batch",
    );
    expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute(
      "href",
      "/compare",
    );
    expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute(
      "href",
      "/sources",
    );
  });
});
