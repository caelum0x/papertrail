// Pure client-side payload builder for the Evidence Workbench. Maps the form's
// string fields to the snake_case wire shape /api/evidence-report expects, failing
// fast with a user-facing message before any network call. No mutation, no I/O.

import type { StudyForm, WireStudy, WorkbenchPayload } from "./types";

function parseNum(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export type BuildResult =
  | { payload: WorkbenchPayload }
  | { error: string };

// Validate + assemble the request. Baseline risk is optional; when present it must
// be a probability strictly inside (0, 1) so absolute effects can be computed.
export function buildPayload(
  claim: string,
  rows: readonly StudyForm[],
  baselineRiskRaw: string,
  // Optional GRADE risk-of-bias downgrade (0/1/2) derived by the RoB panel from
  // the deterministic risk-of-bias engine. Omitted from the request when absent.
  riskOfBiasSteps?: number
): BuildResult {
  if (claim.trim().length < 10) {
    return { error: "Enter a claim of at least 10 characters." };
  }

  const studies: WireStudy[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const point = parseNum(r.point);
    const ciLower = parseNum(r.ciLower);
    const ciUpper = parseNum(r.ciUpper);
    if (point === undefined || ciLower === undefined || ciUpper === undefined) {
      return { error: `Study ${i + 1} needs a point estimate and both CI bounds.` };
    }
    if (!(point > 0 && ciLower > 0 && ciUpper > 0)) {
      return { error: `Study ${i + 1}: point and CI values must be positive ratios.` };
    }
    if (ciUpper <= ciLower) {
      return { error: `Study ${i + 1}: CI upper must exceed CI lower.` };
    }
    studies.push({
      label: r.label.trim() || `Trial ${i + 1}`,
      measure: r.measure,
      point,
      ci_lower: ciLower,
      ci_upper: ciUpper,
    });
  }

  if (studies.length < 2) {
    return { error: "Add at least two studies to synthesize." };
  }

  const baselineRisk = parseNum(baselineRiskRaw);
  if (baselineRiskRaw.trim() !== "") {
    if (baselineRisk === undefined || !(baselineRisk > 0 && baselineRisk < 1)) {
      return { error: "Baseline risk must be a probability strictly between 0 and 1 (e.g. 0.12)." };
    }
  }

  // Risk-of-bias steps, when supplied by the RoB panel, must be an integer 0/1/2 —
  // the GRADE per-domain range. Silently drop anything outside it rather than
  // sending an invalid request the server would reject.
  const robSteps =
    riskOfBiasSteps !== undefined &&
    Number.isInteger(riskOfBiasSteps) &&
    riskOfBiasSteps >= 0 &&
    riskOfBiasSteps <= 2
      ? riskOfBiasSteps
      : undefined;

  return {
    payload: {
      claim: claim.trim(),
      studies,
      ...(baselineRisk !== undefined ? { baselineRisk } : {}),
      ...(robSteps !== undefined ? { risk_of_bias_steps: robSteps } : {}),
    },
  };
}
