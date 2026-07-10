import { describe, it, expect } from "vitest";
import { buildPayload } from "../app/console/workbench/_components/payload";
import type { StudyForm } from "../app/console/workbench/_components/types";

// Minimal sanity test for the workbench payload builder — the only non-UI logic on
// the Evidence Workbench page. Confirms it maps form strings to the snake_case wire
// shape /api/evidence-report expects, fails fast on bad input, and passes an
// optional baseline risk only when valid.

const row = (over: Partial<StudyForm>): StudyForm => ({
  id: "x",
  label: "TrialA",
  measure: "HR",
  point: "0.75",
  ciLower: "0.60",
  ciUpper: "0.94",
  ...over,
});

const CLAIM = "Drug X cuts events by 25% across trials.";

describe("buildPayload", () => {
  it("maps valid rows to the snake_case wire shape and includes baselineRisk when valid", () => {
    const rows = [row({ id: "a" }), row({ id: "b", point: "0.82" })];
    const res = buildPayload(CLAIM, rows, "0.12");
    if ("error" in res) throw new Error(`unexpected error: ${res.error}`);
    expect(res.payload.studies).toHaveLength(2);
    expect(res.payload.studies[0]).toMatchObject({
      label: "TrialA",
      measure: "HR",
      point: 0.75,
      ci_lower: 0.6,
      ci_upper: 0.94,
    });
    expect(res.payload.baselineRisk).toBe(0.12);
  });

  it("omits baselineRisk when the field is left blank", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })];
    const res = buildPayload(CLAIM, rows, "");
    if ("error" in res) throw new Error(`unexpected error: ${res.error}`);
    expect(res.payload.baselineRisk).toBeUndefined();
  });

  it("rejects a CI upper that does not exceed the lower bound", () => {
    const rows = [row({ id: "a", ciLower: "0.9", ciUpper: "0.8" }), row({ id: "b" })];
    const res = buildPayload(CLAIM, rows, "");
    expect("error" in res).toBe(true);
  });

  it("rejects a baseline risk outside (0, 1)", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })];
    const res = buildPayload(CLAIM, rows, "1.5");
    expect("error" in res).toBe(true);
  });

  it("requires at least two studies and a claim of >= 10 chars", () => {
    expect("error" in buildPayload("short", [row({ id: "a" }), row({ id: "b" })], "")).toBe(true);
    expect("error" in buildPayload(CLAIM, [row({ id: "a" })], "")).toBe(true);
  });
});
