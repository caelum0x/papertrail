// Deterministic GRADE-style evidence-certainty rating. Given a pooled
// meta-analysis summary, this rates the CERTAINTY of the body of evidence
// (high | moderate | low | very_low) by applying the standard GRADE downgrade
// rules as pure, rule-decidable arithmetic — NO LLM in the loop. Every step is
// reproducible from the inputs and each downgrade carries an explicit reason and
// a step count, so the rating is fully defensible (like a GRADE Summary of
// Findings "certainty" column).
//
// GRADE model (as used by the GRADE Working Group / GRADEpro):
//   - Bodies of randomized-trial evidence START at "high" certainty.
//   - They can be DOWNGRADED by up to 2 steps in each of five domains:
//       inconsistency, imprecision, risk of bias, indirectness, publication bias.
//   - Total downgrade steps are subtracted from the starting level; the result is
//     clamped at "very_low" (you cannot go below the floor).
//
// This engine derives the *statistical* domains (inconsistency, imprecision)
// deterministically from the pooled numbers, and accepts the *judgement* domains
// (risk of bias, indirectness, publication bias) as caller-supplied step counts —
// those require study-level appraisal a numeric layer cannot invent, so we take
// them as declared inputs rather than guessing.

import { z } from "zod";
import { eggersTest, trimAndFill, type StudyEffect } from "./publicationBias";

// ---------------------------------------------------------------------------
// Certainty levels, ordered from most to least certain. The index is the number
// of steps below "high"; clamping at the ends keeps a rating always valid.
// ---------------------------------------------------------------------------
export type Certainty = "high" | "moderate" | "low" | "very_low";

const CERTAINTY_LADDER: readonly Certainty[] = [
  "high",
  "moderate",
  "low",
  "very_low",
] as const;

export type DowngradeDomain =
  | "inconsistency"
  | "imprecision"
  | "risk_of_bias"
  | "indirectness"
  | "publication_bias";

export interface Downgrade {
  domain: DowngradeDomain;
  reason: string;
  steps: number; // 1 or 2
}

export interface GradeResult {
  certainty: Certainty;
  startingLevel: Certainty; // always "high" for RCT bodies of evidence
  downgrades: Downgrade[];
  rationale: string;
}

// ---------------------------------------------------------------------------
// Thresholds. Each is a documented, conventional GRADE / Cochrane cut-point.
// They are exported so callers/tests can reference the exact same constants.
// ---------------------------------------------------------------------------

// Inconsistency (heterogeneity) — Cochrane Handbook rough I² interpretation:
//   30–60% = moderate, 50–90% = substantial, 75–100% = considerable.
// GRADE downgrades for inconsistency when heterogeneity is substantial and
// unexplained. We use:
//   I² >= 50  -> substantial inconsistency        -> downgrade 1 step
//   I² >= 75  -> considerable inconsistency        -> consider 2 steps
export const I2_INCONSISTENCY_THRESHOLD = 50;
export const I2_INCONSISTENCY_SERIOUS_THRESHOLD = 75;

// Imprecision — a body of evidence is imprecise when the confidence interval is
// wide relative to the decision, or fails to exclude the null:
//   (a) the 95% CI CROSSES THE NULL (not statistically significant)    -> 1 step.
//       GRADE: a CI that includes both appreciable benefit and no effect
//       (or harm) is imprecise for a decision.
//   (b) the CI is WIDE on the ratio scale — upper/lower bound ratio
//       (ciUpper/ciLower) spans an appreciable range. A ratio CI whose
//       upper bound is >= 3x its lower bound is conventionally "wide"
//       (spans an appreciable range of effects)                        -> 1 step.
//   (c) SMALL total sample size — GRADE's "optimal information size" rule of
//       thumb downgrades when the pooled N is below ~400 (a common OIS proxy).
//       A very small N (< 100) is treated as serious                   -> 2 steps
//       when it CO-OCCURS with another imprecision trigger; otherwise it caps
//       the imprecision downgrade at 1 step (you cannot downgrade the same
//       domain more than 2 steps total).
export const RATIO_CI_WIDE_FACTOR = 3; // ciUpper >= ciLower * 3 -> wide
export const OIS_SMALL_N = 400; // below this: optimal information size not met
export const OIS_VERY_SMALL_N = 100; // below this: severe imprecision from N

// Maximum steps any single GRADE domain may contribute.
const MAX_STEPS_PER_DOMAIN = 2;

// ---------------------------------------------------------------------------
// Input schema. Validated at the boundary so a malformed pooled summary fails
// fast rather than silently producing a wrong certainty rating.
// ---------------------------------------------------------------------------
export const gradeInputSchema = z
  .object({
    // Number of studies pooled.
    k: z.number().int().nonnegative(),
    // Heterogeneity I² as a percentage (0..100).
    iSquared: z.number().min(0).max(100),
    // Pooled point estimate and its 95% CI (ratio scale, e.g. RR/HR/OR where
    // the null is 1, but any scale works — only crossesNull and CI width matter).
    point: z.number(),
    ciLower: z.number(),
    ciUpper: z.number(),
    // Whether the 95% CI crosses the null (not statistically significant).
    // Explicit so the caller controls the null convention (1 for ratios, 0 for
    // differences); we never re-derive it and get the scale wrong.
    ciCrossesNull: z.boolean(),
    // Total pooled sample size across studies, if known.
    totalN: z.number().int().positive().nullable().optional(),
    // Caller-supplied judgement downgrades (0, 1, or 2 steps each). These come
    // from study-level appraisal, not from the pooled numbers.
    riskOfBiasSteps: z.number().int().min(0).max(2).optional(),
    indirectnessSteps: z.number().int().min(0).max(2).optional(),
    publicationBiasSteps: z.number().int().min(0).max(2).optional(),
    // OPTIONAL, ADDITIVE: the per-study log effects (label, yi, vi) behind the
    // pooled estimate. When supplied AND the caller has NOT explicitly set
    // `publicationBiasSteps`, GRADE runs Egger's test for funnel-plot asymmetry
    // over these studies and AUTO-DOWNGRADES certainty one step for publication
    // bias on detected asymmetry — deterministically, no LLM. When
    // `publicationBiasSteps` is set, the caller's declared value wins (this input
    // never overrides an explicit judgement). Omit it to preserve prior behaviour.
    studyEffects: z
      .array(
        z.object({
          label: z.string().min(1).max(200),
          yi: z.number().finite(),
          vi: z.number().positive(),
        })
      )
      .max(1000)
      .optional(),
  })
  .refine((v) => v.ciUpper >= v.ciLower, {
    message: "ciUpper must be >= ciLower",
    path: ["ciUpper"],
  });

export type GradeInput = z.infer<typeof gradeInputSchema>;

// A caller-supplied judgement domain: its declared step count and a label used
// when building the downgrade reason.
interface JudgementDomain {
  domain: DowngradeDomain;
  steps: number | undefined;
  label: string;
}

// Round for display in rationale strings.
function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Clamp a step total to [0, MAX_STEPS_PER_DOMAIN].
function capDomainSteps(steps: number): number {
  return Math.max(0, Math.min(MAX_STEPS_PER_DOMAIN, steps));
}

// Derive the inconsistency downgrade from I². Returns null when heterogeneity is
// below the substantial threshold (no downgrade).
function inconsistencyDowngrade(iSquared: number, k: number): Downgrade | null {
  // With 0 or 1 studies there is no between-study heterogeneity to assess.
  if (k < 2) return null;
  if (iSquared < I2_INCONSISTENCY_THRESHOLD) return null;
  const serious = iSquared >= I2_INCONSISTENCY_SERIOUS_THRESHOLD;
  const steps = serious ? 2 : 1;
  const band = serious ? "considerable" : "substantial";
  return {
    domain: "inconsistency",
    reason:
      `I² = ${round(iSquared, 1)}% indicates ${band} unexplained heterogeneity between studies ` +
      `(threshold ${I2_INCONSISTENCY_THRESHOLD}% for a downgrade, ${I2_INCONSISTENCY_SERIOUS_THRESHOLD}% for two steps).`,
    steps,
  };
}

// Derive the imprecision downgrade from the CI and sample size. Multiple triggers
// can co-occur; the domain is capped at 2 steps total.
function imprecisionDowngrade(input: GradeInput): Downgrade | null {
  const reasons: string[] = [];
  let steps = 0;

  if (input.ciCrossesNull) {
    steps += 1;
    reasons.push(
      `the 95% CI (${round(input.ciLower, 3)} to ${round(input.ciUpper, 3)}) crosses the null, so the estimate is not statistically significant`
    );
  }

  // A ratio CI bound "approaches the null" when it sits within ~10% of no-effect (0.9–1.11 on
  // the ratio scale). A numerically wide ratio CI is a genuine imprecision concern ONLY when it
  // stretches from an appreciable effect to a bound near the null (decision uncertainty). A wide
  // CI whose bounds are BOTH decisively away from the null (e.g. RR 0.30, 95% CI 0.15–0.60) is
  // still decisive, and GRADE does not downgrade it for imprecision — the old rule did, spuriously.
  const NEAR_NULL_LOW = 0.9;
  const NEAR_NULL_HIGH = 1 / 0.9; // ≈1.111 — symmetric on the ratio scale
  const boundNearNull = (b: number) => b >= NEAR_NULL_LOW && b <= NEAR_NULL_HIGH;
  const ratioWide =
    input.ciLower > 0 &&
    input.ciUpper >= input.ciLower * RATIO_CI_WIDE_FACTOR &&
    (input.ciCrossesNull ||
      boundNearNull(input.ciLower) ||
      boundNearNull(input.ciUpper));
  if (ratioWide) {
    steps += 1;
    reasons.push(
      `the 95% CI spans an appreciable range toward the null (upper bound ${round(input.ciUpper, 3)} is ` +
        `>= ${RATIO_CI_WIDE_FACTOR}x the lower bound ${round(input.ciLower, 3)})`
    );
  }

  // GRADE treats "optimal information size not met" as a 1-step imprecision downgrade on its
  // own (a documented, widely-used OIS proxy for imprecision). A very small N is more serious,
  // escalating to 2 steps only when it CO-OCCURS with another imprecision trigger (a
  // null-crossing or a wide-toward-null CI); a very small N alone stays a single step.
  const otherImprecisionTrigger = input.ciCrossesNull || ratioWide;
  const totalN = input.totalN ?? null;
  if (totalN !== null && totalN < OIS_VERY_SMALL_N) {
    steps += otherImprecisionTrigger ? 2 : 1;
    reasons.push(
      `the pooled sample size (N=${totalN}) is very small (below ${OIS_VERY_SMALL_N}), well under the optimal information size` +
        (otherImprecisionTrigger
          ? " and compounds the other imprecision above"
          : "")
    );
  } else if (totalN !== null && totalN < OIS_SMALL_N) {
    steps += 1;
    reasons.push(
      `the pooled sample size (N=${totalN}) does not meet the optimal information size (${OIS_SMALL_N})`
    );
  }

  if (steps === 0) return null;

  return {
    domain: "imprecision",
    reason: `Imprecision: ${reasons.join("; ")}.`,
    steps: capDomainSteps(steps),
  };
}

// ADDITIVE: derive the publication-bias downgrade from the per-study effects,
// used ONLY when the caller supplied `studyEffects` and did NOT set an explicit
// `publicationBiasSteps`. Runs Egger's regression test for funnel-plot asymmetry;
// on detected asymmetry, downgrades ONE step for publication bias and cites the
// trim-and-fill bias-adjusted estimate (how far the summary shifts toward the
// null once the funnel is filled) so the downgrade is fully defensible. Returns
// null when the test cannot run (fewer than three usable studies) or finds no
// asymmetry — an honest "no downgrade" rather than a forced one. Deterministic.
// Minimum studies before a funnel-plot asymmetry test may drive an automated certainty
// downgrade. Sterne et al. 2011 / Cochrane Handbook §13: tests for funnel asymmetry are
// underpowered and uninterpretable with fewer than ~10 studies, so running Egger below this
// and acting on it is methodologically unsound. Below the threshold we return "no downgrade"
// (honest) rather than penalizing the body of evidence on an uninterpretable test.
const MIN_STUDIES_FOR_PUBLICATION_BIAS = 10;

function derivedPublicationBiasDowngrade(
  studyEffects: readonly StudyEffect[]
): Downgrade | null {
  if (studyEffects.length < MIN_STUDIES_FOR_PUBLICATION_BIAS) return null;
  const egger = eggersTest(studyEffects);
  if (egger === null || !egger.asymmetry) return null;

  const adjusted = trimAndFill(studyEffects);
  const trimNote =
    adjusted && adjusted.k0Imputed > 0
      ? ` Trim-and-fill imputes ${adjusted.k0Imputed} missing ${
          adjusted.k0Imputed === 1 ? "study" : "studies"
        } on the ${adjusted.side} side; the bias-adjusted pooled estimate is ${round(
          adjusted.adjustedPoint,
          3
        )} (95% CI ${round(adjusted.adjustedCiLower, 3)}–${round(
          adjusted.adjustedCiUpper,
          3
        )}), shifted toward the null.`
      : "";

  return {
    domain: "publication_bias",
    reason:
      `Egger's test for funnel-plot asymmetry is significant over ${egger.k} studies ` +
      `(intercept ${round(egger.intercept, 3)}, p=${round(egger.pValue, 3)}), indicating ` +
      `possible small-study effects / publication bias — downgrade 1 step.${trimNote}`,
    steps: 1,
  };
}

// Build a downgrade entry for a caller-supplied judgement domain, or null when
// the caller declared 0 (or omitted) steps for it.
function judgementDowngrade(d: JudgementDomain): Downgrade | null {
  const steps = capDomainSteps(d.steps ?? 0);
  if (steps === 0) return null;
  return {
    domain: d.domain,
    reason: `${d.label}: caller-supplied downgrade of ${steps} step${steps === 1 ? "" : "s"} from study-level appraisal.`,
    steps,
  };
}

/**
 * Rate the certainty of a pooled body of evidence using deterministic GRADE
 * downgrade rules. Bodies of RCT evidence start at "high" and are downgraded by
 * the summed steps across five domains (inconsistency + imprecision derived from
 * the pooled numbers; risk of bias, indirectness, and publication bias supplied
 * by the caller). The final level is clamped at "very_low".
 *
 * Pure: validates and copies its input, never mutates it, and puts no LLM in the
 * numeric loop — every step is reproducible from the thresholds above.
 */
export function gradeCertainty(rawInput: GradeInput): GradeResult {
  const input = gradeInputSchema.parse(rawInput);

  const startingLevel: Certainty = "high";

  const downgrades: Downgrade[] = [];

  const inconsistency = inconsistencyDowngrade(input.iSquared, input.k);
  if (inconsistency) downgrades.push(inconsistency);

  const imprecision = imprecisionDowngrade(input);
  if (imprecision) downgrades.push(imprecision);

  const judgementDomains: JudgementDomain[] = [
    { domain: "risk_of_bias", steps: input.riskOfBiasSteps, label: "Risk of bias" },
    { domain: "indirectness", steps: input.indirectnessSteps, label: "Indirectness" },
  ];
  for (const d of judgementDomains) {
    const dg = judgementDowngrade(d);
    if (dg) downgrades.push(dg);
  }

  // Publication bias (additive). An explicitly-declared `publicationBiasSteps`
  // always wins (caller judgement). Otherwise, when per-study `studyEffects` are
  // supplied, Egger's test decides the downgrade deterministically.
  if (input.publicationBiasSteps !== undefined) {
    const declared = judgementDowngrade({
      domain: "publication_bias",
      steps: input.publicationBiasSteps,
      label: "Publication bias",
    });
    if (declared) downgrades.push(declared);
  } else if (input.studyEffects && input.studyEffects.length > 0) {
    const derived = derivedPublicationBiasDowngrade(input.studyEffects);
    if (derived) downgrades.push(derived);
  }

  const totalSteps = downgrades.reduce((acc, d) => acc + d.steps, 0);

  // Subtract steps from the starting level, clamped to the ladder bounds.
  const startIndex = CERTAINTY_LADDER.indexOf(startingLevel);
  const finalIndex = Math.min(
    CERTAINTY_LADDER.length - 1,
    Math.max(0, startIndex + totalSteps)
  );
  const certainty = CERTAINTY_LADDER[finalIndex];

  const rationale = buildRationale(startingLevel, certainty, totalSteps, downgrades);

  return { certainty, startingLevel, downgrades, rationale };
}

function buildRationale(
  start: Certainty,
  certainty: Certainty,
  totalSteps: number,
  downgrades: readonly Downgrade[]
): string {
  if (downgrades.length === 0) {
    return `Started at ${start} certainty with no downgrades: evidence is consistent, precise, and free of declared risk-of-bias, indirectness, or publication-bias concerns. Certainty: ${certainty}.`;
  }
  const domainSummary = downgrades
    .map((d) => `${d.domain} (-${d.steps})`)
    .join(", ");
  return (
    `Started at ${start} certainty; downgraded ${totalSteps} step${totalSteps === 1 ? "" : "s"} for ${domainSummary}. ` +
    `Final certainty: ${certainty}.`
  );
}
