// Deterministic risk-of-bias (RoB) assessment for a single randomized trial.
// This COMPLETES automated GRADE: lib/grade.ts derives the statistical domains
// (inconsistency, imprecision) from pooled numbers but takes risk of bias as a
// caller-supplied step count. This engine DERIVES that step count from explicit,
// reviewer-answerable facts about a trial — the Cochrane RoB 2 style domains — so
// the whole GRADE chain is reproducible with NO LLM in the numeric loop.
//
// Model (Cochrane Risk of Bias 2, adapted to rule-decidable inputs):
//   A trial is appraised across several DOMAINS. Each domain is judged
//   low | some_concerns | high from the reviewer's declared answers. A subset of
//   domains are CRITICAL (the classic sources of systematic error in an RCT):
//   randomization, allocation concealment, blinding, attrition, selective
//   reporting. The remaining PRAGMATIC flags (small sample, early stopping for
//   benefit, industry-only funding) can only raise concern, never on their own
//   force a "high" overall — they nudge the judgement.
//
// Reduction to a GRADE downgrade step count (0/1/2), documented per rule below:
//   - No critical domain is 'high'                                  -> 0 steps
//   - Exactly ONE critical domain is 'high'                         -> 1 step
//   - TWO OR MORE critical domains are 'high'                       -> 2 steps
//   Pragmatic flags never add a step by themselves, but a 'high' pragmatic flag
//   combined with any critical 'some_concerns' escalates the overall judgement to
//   'high' (see overallJudgement) — matching how GRADE treats accumulating
//   "some concerns" as tipping into serious risk of bias.
//
// Every domain returns an explicit `reason` string so the rating is defensible.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Per-domain and overall judgements. Ordered from least to most concerning; the
// index doubles as a severity rank used when reducing to an overall judgement.
// ---------------------------------------------------------------------------
export type RobJudgement = "low" | "some_concerns" | "high";

const JUDGEMENT_RANK: readonly RobJudgement[] = [
  "low",
  "some_concerns",
  "high",
] as const;

function rank(j: RobJudgement): number {
  return JUDGEMENT_RANK.indexOf(j);
}

function worst(a: RobJudgement, b: RobJudgement): RobJudgement {
  return rank(a) >= rank(b) ? a : b;
}

export type RobDomainName =
  | "randomization"
  | "allocation_concealment"
  | "blinding"
  | "incomplete_outcome_data"
  | "selective_reporting"
  | "small_sample"
  | "early_stopping"
  | "funding";

// The critical domains: the classic systematic-error sources in an RCT. Only
// these count toward the GRADE step reduction. The remaining domains are
// pragmatic flags that inform the overall judgement but never add a step alone.
const CRITICAL_DOMAINS: ReadonlySet<RobDomainName> = new Set<RobDomainName>([
  "randomization",
  "allocation_concealment",
  "blinding",
  "incomplete_outcome_data",
  "selective_reporting",
]);

export interface RobDomain {
  name: RobDomainName;
  judgement: RobJudgement;
  reason: string;
}

export interface RiskOfBiasResult {
  domains: RobDomain[];
  overall: RobJudgement;
  // GRADE downgrade steps this trial's risk of bias contributes: 0, 1, or 2.
  // Feeds directly into gradeCertainty(...).riskOfBiasSteps.
  gradeSteps: number;
}

// ---------------------------------------------------------------------------
// Input schema. Every field is a fact a reviewer can answer directly from a
// paper's methods/results — no numeric guessing, no LLM. Validated at the
// boundary so a malformed trial fails fast instead of producing a wrong rating.
// ---------------------------------------------------------------------------

// How blinding was implemented. "open_label" is unblinded; "double_blind" blinds
// both participants and personnel; "single_blind" blinds only one side; "unclear"
// is not reported.
export type BlindingLevel =
  | "double_blind"
  | "single_blind"
  | "open_label"
  | "unclear";

// Whether the primary outcome is objective (e.g. all-cause mortality, lab value —
// hard to bias even when open-label) or subjective (clinician/patient-rated —
// sensitive to lack of blinding).
export type OutcomeType = "objective" | "subjective";

// Funding source. Industry-only funding is a recognized (pragmatic) RoB flag.
export type FundingSource = "public" | "mixed" | "industry_only" | "unclear";

export const riskOfBiasInputSchema = z.object({
  // Randomization: was a genuine random sequence generated?
  randomSequenceGenerated: z.boolean(),
  // Allocation concealment: was the upcoming assignment hidden from enrollers?
  allocationConcealed: z.boolean(),
  // Blinding of participants/personnel.
  blinding: z.enum(["double_blind", "single_blind", "open_label", "unclear"]),
  // Whether the outcome assessor was blinded (independent of participant blinding).
  outcomeAssessorBlinded: z.boolean(),
  // Objective outcomes are robust to lack of blinding; subjective are not.
  outcomeType: z.enum(["objective", "subjective"]),
  // Incomplete outcome data (attrition). Overall dropout proportion 0..1 and
  // whether the analysis was intention-to-treat (ITT).
  attritionRate: z.number().min(0).max(1),
  intentionToTreat: z.boolean(),
  // Selective reporting: was the trial pre-registered and are all pre-specified
  // primary outcomes reported?
  preRegistered: z.boolean(),
  allPrespecifiedOutcomesReported: z.boolean(),
  // Pragmatic flags.
  sampleSize: z.number().int().positive().nullable().optional(),
  stoppedEarlyForBenefit: z.boolean().optional(),
  funding: z
    .enum(["public", "mixed", "industry_only", "unclear"])
    .optional(),
});

export type RiskOfBiasInput = z.infer<typeof riskOfBiasInputSchema>;

// Attrition thresholds (proportion of participants lost). Convention: <5% low,
// 5–20% some concerns, >20% high risk of attrition bias (Cochrane rules of thumb).
export const ATTRITION_SOME_CONCERNS = 0.05;
export const ATTRITION_HIGH = 0.2;

// "Small sample" pragmatic threshold: fragile trials below this total N.
export const SMALL_SAMPLE_N = 100;

// ---------------------------------------------------------------------------
// Per-domain rules. Each returns a judgement + an explicit reason.
// ---------------------------------------------------------------------------

// Randomization (critical). A genuinely generated random sequence -> low; a
// non-random / unreported sequence is a high risk of selection bias.
function assessRandomization(input: RiskOfBiasInput): RobDomain {
  if (input.randomSequenceGenerated) {
    return {
      name: "randomization",
      judgement: "low",
      reason: "A random allocation sequence was generated.",
    };
  }
  return {
    name: "randomization",
    judgement: "high",
    reason:
      "No genuine random sequence generation was reported — high risk of selection bias.",
  };
}

// Allocation concealment (critical). Concealed -> low. Unconcealed allocation
// lets enrollers subvert randomization, so it is a high risk of selection bias.
function assessAllocationConcealment(input: RiskOfBiasInput): RobDomain {
  if (input.allocationConcealed) {
    return {
      name: "allocation_concealment",
      judgement: "low",
      reason: "Allocation was concealed from those enrolling participants.",
    };
  }
  return {
    name: "allocation_concealment",
    judgement: "high",
    reason:
      "Allocation was not concealed — enrollers could foresee assignments (selection bias).",
  };
}

// Blinding (critical). Rule: double-blind with a blinded assessor -> low. The
// effect of missing blinding depends on the outcome: an OBJECTIVE outcome (e.g.
// mortality) is robust to open-label, so it is only 'some_concerns'; a SUBJECTIVE
// outcome under open-label / unblinded assessment is 'high' (performance +
// detection bias). "unclear" reporting is at least 'some_concerns'.
function assessBlinding(input: RiskOfBiasInput): RobDomain {
  const fullyBlinded =
    input.blinding === "double_blind" && input.outcomeAssessorBlinded;
  if (fullyBlinded) {
    return {
      name: "blinding",
      judgement: "low",
      reason:
        "Double-blind design with a blinded outcome assessor — low risk of performance/detection bias.",
    };
  }

  const unblinded =
    input.blinding === "open_label" || !input.outcomeAssessorBlinded;

  if (input.outcomeType === "objective") {
    // Objective outcomes (e.g. mortality) resist bias from lack of blinding, so
    // incomplete/unclear blinding is at most 'some_concerns', never 'high'.
    return {
      name: "blinding",
      judgement: "some_concerns",
      reason:
        "Blinding was incomplete or unclear, but the primary outcome is objective, which is robust to lack of blinding — some concerns.",
    };
  }

  // Subjective outcome.
  if (unblinded) {
    return {
      name: "blinding",
      judgement: "high",
      reason:
        "Subjective outcome assessed without full blinding (open-label or unblinded assessor) — high risk of performance/detection bias.",
    };
  }
  return {
    name: "blinding",
    judgement: "some_concerns",
    reason:
      "Blinding of a subjective outcome is only partial or unclear — some concerns.",
  };
}

// Incomplete outcome data / attrition (critical). Thresholds above. ITT analysis
// mitigates moderate attrition: with ITT, a 'high' attrition rate is softened to
// 'some_concerns' because the analysis preserves randomization.
function assessAttrition(input: RiskOfBiasInput): RobDomain {
  const pct = (input.attritionRate * 100).toFixed(1);
  if (input.attritionRate > ATTRITION_HIGH) {
    if (input.intentionToTreat) {
      return {
        name: "incomplete_outcome_data",
        judgement: "some_concerns",
        reason: `Attrition is high (${pct}%) but an intention-to-treat analysis preserves randomization — some concerns.`,
      };
    }
    return {
      name: "incomplete_outcome_data",
      judgement: "high",
      reason: `Attrition is high (${pct}%, over ${ATTRITION_HIGH * 100}%) without an intention-to-treat analysis — high risk of attrition bias.`,
    };
  }
  if (input.attritionRate >= ATTRITION_SOME_CONCERNS) {
    return {
      name: "incomplete_outcome_data",
      judgement: input.intentionToTreat ? "low" : "some_concerns",
      reason: input.intentionToTreat
        ? `Moderate attrition (${pct}%) handled by an intention-to-treat analysis — low risk.`
        : `Moderate attrition (${pct}%) without a stated intention-to-treat analysis — some concerns.`,
    };
  }
  return {
    name: "incomplete_outcome_data",
    judgement: "low",
    reason: `Low attrition (${pct}%, under ${ATTRITION_SOME_CONCERNS * 100}%) — low risk of attrition bias.`,
  };
}

// Selective reporting (critical). Pre-registered AND all pre-specified outcomes
// reported -> low. Missing pre-registration is 'some_concerns' (can't confirm the
// protocol); a registered trial that omits pre-specified outcomes is 'high'
// (evidence of outcome-reporting bias).
function assessSelectiveReporting(input: RiskOfBiasInput): RobDomain {
  if (input.preRegistered && input.allPrespecifiedOutcomesReported) {
    return {
      name: "selective_reporting",
      judgement: "low",
      reason:
        "Pre-registered and all pre-specified outcomes are reported — low risk of selective reporting.",
    };
  }
  if (input.preRegistered && !input.allPrespecifiedOutcomesReported) {
    return {
      name: "selective_reporting",
      judgement: "high",
      reason:
        "Pre-registered but not all pre-specified outcomes are reported — high risk of selective outcome reporting.",
    };
  }
  return {
    name: "selective_reporting",
    judgement: "some_concerns",
    reason:
      "No pre-registration available to confirm the pre-specified outcomes — some concerns about selective reporting.",
  };
}

// Small sample (pragmatic). Below SMALL_SAMPLE_N -> some concerns (fragile,
// vulnerable to chance imbalance). Never 'high' on its own.
function assessSmallSample(input: RiskOfBiasInput): RobDomain {
  const n = input.sampleSize ?? null;
  if (n !== null && n < SMALL_SAMPLE_N) {
    return {
      name: "small_sample",
      judgement: "some_concerns",
      reason: `Small total sample size (N=${n}, under ${SMALL_SAMPLE_N}) — fragile to chance imbalance.`,
    };
  }
  return {
    name: "small_sample",
    judgement: "low",
    reason:
      n !== null
        ? `Adequate sample size (N=${n}).`
        : "Sample size not provided; no small-sample concern raised.",
  };
}

// Early stopping for benefit (pragmatic). Trials stopped early for benefit tend
// to overestimate effects -> some concerns. Never 'high' alone.
function assessEarlyStopping(input: RiskOfBiasInput): RobDomain {
  if (input.stoppedEarlyForBenefit) {
    return {
      name: "early_stopping",
      judgement: "some_concerns",
      reason:
        "Trial stopped early for benefit, which tends to overestimate the effect size — some concerns.",
    };
  }
  return {
    name: "early_stopping",
    judgement: "low",
    reason: "Trial ran to its planned conclusion (not stopped early for benefit).",
  };
}

// Funding (pragmatic). Industry-only funding is a recognized flag -> some
// concerns; unclear funding -> some concerns; public/mixed -> low. Never 'high'.
function assessFunding(input: RiskOfBiasInput): RobDomain {
  const funding = input.funding ?? "unclear";
  if (funding === "industry_only") {
    return {
      name: "funding",
      judgement: "some_concerns",
      reason:
        "Industry-only funding is a recognized potential source of bias — some concerns.",
    };
  }
  if (funding === "unclear") {
    return {
      name: "funding",
      judgement: "some_concerns",
      reason: "Funding source is not clearly reported — some concerns.",
    };
  }
  return {
    name: "funding",
    judgement: "low",
    reason: `Funding is ${funding}; no funding-related concern raised.`,
  };
}

// ---------------------------------------------------------------------------
// Overall judgement and GRADE step reduction.
// ---------------------------------------------------------------------------

// Overall judgement: the worst of the critical domains, then escalated one notch
// if pragmatic flags accumulate on top of existing concern. Specifically, when a
// critical domain is already 'some_concerns' AND any pragmatic flag is raised,
// the accumulated concern tips the overall to 'high' — mirroring GRADE's practice
// of treating multiple "some concerns" as serious risk of bias.
function overallJudgement(domains: readonly RobDomain[]): RobJudgement {
  const critical = domains.filter((d) => CRITICAL_DOMAINS.has(d.name));
  const pragmatic = domains.filter((d) => !CRITICAL_DOMAINS.has(d.name));

  let overall = critical.reduce<RobJudgement>(
    (acc, d) => worst(acc, d.judgement),
    "low"
  );

  const anyPragmaticConcern = pragmatic.some(
    (d) => d.judgement !== "low"
  );
  const criticalSomeConcerns = critical.some(
    (d) => d.judgement === "some_concerns"
  );

  if (overall === "some_concerns" && criticalSomeConcerns && anyPragmaticConcern) {
    overall = "high";
  }
  return overall;
}

// GRADE step reduction from the CRITICAL domains only:
//   0 'high' critical domains -> 0 steps
//   1 'high' critical domain  -> 1 step
//   2+ 'high' critical domains -> 2 steps (the GRADE per-domain cap)
function gradeStepsFromDomains(domains: readonly RobDomain[]): number {
  const highCriticalCount = domains.filter(
    (d) => CRITICAL_DOMAINS.has(d.name) && d.judgement === "high"
  ).length;
  const steps = highCriticalCount >= 2 ? 2 : highCriticalCount === 1 ? 1 : 0;
  // CONSISTENCY with overallJudgement: when the overall judgement escalates to 'high' via the
  // pragmatic-flag path (a critical some-concerns domain compounded by small-sample / early-
  // stopping / funding concerns) but no single critical domain is judged 'high', the trial is
  // still OVERALL high risk of bias and must downgrade at least one GRADE step. Without this a
  // trial the engine reports as overall:high would contribute gradeSteps:0 — an internal
  // contradiction where high-bias evidence silently downgrades nothing.
  if (steps === 0 && overallJudgement(domains) === "high") return 1;
  return steps;
}

/**
 * Assess the risk of bias of a single randomized trial from explicit,
 * reviewer-answerable inputs, and reduce it to (a) an overall RoB judgement and
 * (b) a GRADE downgrade step count (0/1/2) that plugs directly into
 * gradeCertainty(...).riskOfBiasSteps.
 *
 * Pure: validates and copies its input, never mutates it, and puts no LLM in the
 * loop — every domain and the final step count are reproducible from the rules
 * documented above.
 */
export function assessRiskOfBias(rawInput: RiskOfBiasInput): RiskOfBiasResult {
  const input = riskOfBiasInputSchema.parse(rawInput);

  const domains: RobDomain[] = [
    assessRandomization(input),
    assessAllocationConcealment(input),
    assessBlinding(input),
    assessAttrition(input),
    assessSelectiveReporting(input),
    assessSmallSample(input),
    assessEarlyStopping(input),
    assessFunding(input),
  ];

  const overall = overallJudgement(domains);
  const gradeSteps = gradeStepsFromDomains(domains);

  return { domains, overall, gradeSteps };
}
