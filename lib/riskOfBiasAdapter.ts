// RISK-OF-BIAS ADAPTER — the thin, additive bridge between the per-trial
// risk-of-bias engine (lib/riskOfBias.ts) and the composite evidence pipeline
// (lib/evidenceReport.ts → lib/grade.ts). Both of those files are owner-reserved,
// so this adapter does NOT edit them: it takes one-or-more reviewer-supplied
// risk-of-bias assessments, runs the deterministic assessRiskOfBias engine on
// each, and REDUCES the body of evidence to a single GRADE downgrade step count
// (0/1/2) that a caller can pass straight into buildEvidenceReport's optional
// `riskOfBiasSteps` (which forwards it to gradeCertainty).
//
// Why a MAX across studies? GRADE rates the risk of bias of the whole BODY of
// evidence, not one trial. When the pooled estimate leans on trials of differing
// quality, the body inherits the concern of its weakest contributing trials —
// the standard GRADE practice of downgrading for risk of bias when studies
// contributing substantial weight are at high risk. Taking the maximum per-study
// step count (capped at the GRADE per-domain limit of 2) is the conservative,
// fully rule-decidable reduction. NO LLM is anywhere in this path; every number
// traces back through assessRiskOfBias to the reviewer's declared trial facts.
//
// Pure: validates its input at the boundary, never mutates it, performs no I/O.

import { z } from "zod";
import {
  assessRiskOfBias,
  riskOfBiasInputSchema,
  type RiskOfBiasInput,
  type RiskOfBiasResult,
  type RobJudgement,
} from "./riskOfBias";

// The GRADE per-domain downgrade cap (risk of bias may remove at most 2 steps).
const MAX_ROB_STEPS = 2;

// Rank used to pick the "worst" overall judgement across the body of evidence,
// mirroring the ordering in lib/riskOfBias (low < some_concerns < high).
const JUDGEMENT_RANK: Readonly<Record<RobJudgement, number>> = {
  low: 0,
  some_concerns: 1,
  high: 2,
};

// ---------------------------------------------------------------------------
// Input schema. Accept EITHER a single trial's RoB facts, or an array of them
// (one per contributing study). Validated at the boundary so a malformed
// assessment fails fast rather than silently producing a wrong step count.
// ---------------------------------------------------------------------------
export const RiskOfBiasAssessmentInputSchema = z.union([
  riskOfBiasInputSchema,
  z.array(riskOfBiasInputSchema).min(1).max(100),
]);

export type RiskOfBiasAssessmentInput = z.infer<
  typeof RiskOfBiasAssessmentInputSchema
>;

// One assessed study, carrying its full engine result plus an optional label so a
// caller (or the UI) can trace the aggregate back to the trial that drove it.
export interface AssessedStudyRoB {
  label: string | null;
  result: RiskOfBiasResult;
}

// The adapter's output: the aggregate GRADE step count for the whole body of
// evidence, the worst overall judgement, and the per-study assessments it was
// derived from. `riskOfBiasSteps` is exactly the value to hand to
// buildEvidenceReport({ ..., riskOfBiasSteps }).
export interface BodyRiskOfBias {
  // GRADE downgrade steps for the body of evidence: 0, 1, or 2.
  riskOfBiasSteps: number;
  // The worst per-study overall judgement across the body of evidence.
  overall: RobJudgement;
  // Per-study assessments, in input order.
  perStudy: AssessedStudyRoB[];
  // Plain-language justification a reviewer can defend.
  rationale: string;
}

function worstJudgement(a: RobJudgement, b: RobJudgement): RobJudgement {
  return JUDGEMENT_RANK[a] >= JUDGEMENT_RANK[b] ? a : b;
}

function cap(steps: number): number {
  return Math.max(0, Math.min(MAX_ROB_STEPS, steps));
}

// A per-study assessment paired with an optional label, so the caller can name
// the trials feeding the aggregate (e.g. reuse the study labels already on the
// evidence-report request). Labels are optional and never required.
export interface LabeledRiskOfBiasInput {
  label?: string | null;
  input: RiskOfBiasInput;
}

// Normalise the union/labeled forms into a flat list of { label, input } items.
function normalise(
  input: RiskOfBiasAssessmentInput | readonly LabeledRiskOfBiasInput[]
): LabeledRiskOfBiasInput[] {
  if (Array.isArray(input)) {
    // Could be RiskOfBiasInput[] or LabeledRiskOfBiasInput[]; discriminate on the
    // presence of an `input` field (the labeled wrapper).
    return input.map((item) => {
      if (item && typeof item === "object" && "input" in item) {
        const labeled = item as LabeledRiskOfBiasInput;
        return { label: labeled.label ?? null, input: labeled.input };
      }
      return { label: null, input: item as RiskOfBiasInput };
    });
  }
  return [{ label: null, input: input as RiskOfBiasInput }];
}

function buildRationale(
  perStudy: readonly AssessedStudyRoB[],
  steps: number,
  overall: RobJudgement
): string {
  if (perStudy.length === 1) {
    const only = perStudy[0];
    const who = only.label ? `“${only.label}”` : "the single assessed trial";
    return (
      `Risk of bias for ${who} is ${overall.replace("_", " ")}, contributing a ` +
      `${steps}-step GRADE downgrade for risk of bias.`
    );
  }
  const driver = perStudy.reduce((acc, s) =>
    s.result.gradeSteps > acc.result.gradeSteps ? s : acc
  );
  const who = driver.label ? `“${driver.label}”` : "at least one contributing trial";
  return (
    `Across ${perStudy.length} assessed trials the body of evidence inherits the ` +
    `weakest contributor's risk of bias (${who}, ${overall.replace("_", " ")}), for a ` +
    `${steps}-step GRADE downgrade for risk of bias.`
  );
}

/**
 * Assess the risk of bias of a body of evidence and reduce it to a single GRADE
 * downgrade step count (0/1/2) plus its per-study detail.
 *
 * Accepts a single trial's RoB facts, an array of them, or an array of
 * { label, input } pairs (to name the trials). Runs the deterministic
 * assessRiskOfBias engine on each and takes the MAX per-study step count (capped
 * at 2) and the worst overall judgement — the conservative body-level rule.
 *
 * The returned `riskOfBiasSteps` is exactly the value to pass to
 * buildEvidenceReport({ claim, studies, riskOfBiasSteps }). Pure: validates and
 * copies its input, never mutates it, and puts no LLM in the loop.
 */
export function assessBodyRiskOfBias(
  input: RiskOfBiasAssessmentInput | readonly LabeledRiskOfBiasInput[]
): BodyRiskOfBias {
  const items = normalise(input);

  const perStudy: AssessedStudyRoB[] = items.map((item) => ({
    label: item.label ?? null,
    // assessRiskOfBias re-validates each input at its own boundary.
    result: assessRiskOfBias(item.input),
  }));

  const riskOfBiasSteps = cap(
    perStudy.reduce((max, s) => Math.max(max, s.result.gradeSteps), 0)
  );

  const overall = perStudy.reduce<RobJudgement>(
    (acc, s) => worstJudgement(acc, s.result.overall),
    "low"
  );

  const rationale = buildRationale(perStudy, riskOfBiasSteps, overall);

  return { riskOfBiasSteps, overall, perStudy, rationale };
}
