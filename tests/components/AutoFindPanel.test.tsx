import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AutoFindPanel } from "../../app/console/workbench/_components/AutoFindPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AutoFindPanel", () => {
  it("POSTs the claim to the evidence pipeline and renders used/skipped sources", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          claim: "Drug X cuts events by 30% across trials.",
          usedSources: [
            { id: "src-1", title: "Trial A primary results", source_type: "clinicaltrials" },
          ],
          skipped: [{ id: "src-2", reason: "No extractable ratio effect." }],
          report: {
            ok: false,
            claim: "Drug X cuts events by 30% across trials.",
            reason: "Only one usable study was found.",
            claimedReductionPercent: 30,
            usableStudies: 1,
            skipped: [],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AutoFindPanel />);

    fireEvent.change(screen.getByLabelText("Claim"), {
      target: { value: "Drug X cuts events by 30% across trials." },
    });
    fireEvent.click(screen.getByRole("button", { name: /auto-find & synthesize/i }));

    await waitFor(() => {
      expect(screen.getByText("Trial A primary results")).toBeInTheDocument();
    });
    expect(screen.getByText(/No extractable ratio effect\./)).toBeInTheDocument();
    expect(screen.getByText("Insufficient evidence")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/evidence-pipeline",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
