// DOSE–RESPONSE SANITY rule engine.
//
// A bioinformatics/pharmacology finding often rests on a dose–response relationship:
// increasing dose should produce a monotone change in response (a well-behaved curve),
// and a claimed potency should be plausible for the compound's development phase. This
// engine checks BOTH, DETERMINISTICALLY and with NO LLM.
//
// It is a PURE numeric engine over the (dose, response) points and the optional
// claimed potency/phase; the potency-vs-phase check reuses the SAME order-of-magnitude
// reasoning and phase-comparison patterns as lib/bio/chembl.ts (POTENCY_BAND_ORDERS,
// comparePhase), so the two modules judge potency/phase the same way. Nothing is
// fabricated: too few points, or no claimed potency/phase, yields an honest empty.

import type { FindingSignal } from "@/lib/bio/bioinformatics.schemas";

// One measured dose–response point. `dose` is the independent variable (concentration /
// dose), `response` the measured effect. Both finite; dose non-negative.
export interface DoseResponsePoint {
  dose: number;
  response: number;
}

// --- Monotonicity ---------------------------------------------------------------

export type Monotonicity =
  | "monotone_increasing"
  | "monotone_decreasing"
  | "non_monotone"
  | "insufficient_points";

// A dose–response curve is expected to be MONOTONE (response consistently rises or falls
// with dose) over the tested range. A non-monotone curve (response goes up then down for
// no stated biphasic reason) is a data-sanity flag. We sort by dose and inspect the sign
// of successive response deltas; ties (flat segments) don't break monotonicity.
export function assessMonotonicity(points: DoseResponsePoint[]): {
  monotonicity: Monotonicity;
  reason: string;
} {
  const clean = points
    .filter(
      (p) =>
        Number.isFinite(p.dose) &&
        Number.isFinite(p.response) &&
        p.dose >= 0
    )
    .slice()
    .sort((a, b) => a.dose - b.dose);

  if (clean.length < 3) {
    return {
      monotonicity: "insufficient_points",
      reason: `Only ${clean.length} usable dose–response point(s); at least 3 are needed to assess monotonicity.`,
    };
  }

  let sawIncrease = false;
  let sawDecrease = false;
  for (let i = 1; i < clean.length; i++) {
    const delta = clean[i].response - clean[i - 1].response;
    if (delta > 0) sawIncrease = true;
    else if (delta < 0) sawDecrease = true;
  }

  if (sawIncrease && sawDecrease) {
    return {
      monotonicity: "non_monotone",
      reason:
        "The dose–response curve is non-monotone (response both rises and falls across increasing dose), which is a data-sanity concern for a simple dose–response claim.",
    };
  }
  if (sawDecrease) {
    return {
      monotonicity: "monotone_decreasing",
      reason: "Response decreases monotonically with dose.",
    };
  }
  if (sawIncrease) {
    return {
      monotonicity: "monotone_increasing",
      reason: "Response increases monotonically with dose.",
    };
  }
  return {
    monotonicity: "monotone_increasing",
    reason: "Response is flat across dose (trivially monotone).",
  };
}

// --- Potency-vs-phase plausibility ----------------------------------------------

// REUSED from lib/bio/chembl.ts: potencies are compared on an order-of-magnitude band.
// A claimed clinical-stage compound (phase >= this) with an implausibly weak potency is
// a plausibility flag — a drug that reached the clinic is not typically a micromolar-
// weak binder at its primary target.
const CLINICAL_PHASE_THRESHOLD = 2;
// Field-standard "clinical-grade potency" ceiling in nM. A primary-target potency far
// weaker than this (i.e. a much larger nM value) for a clinical-phase compound is
// implausible. 1000 nM (1 µM) is a conventional soft ceiling for a lead/clinical binder.
export const CLINICAL_POTENCY_CEILING_NM = 1000;

export type PotencyPhasePlausibility =
  | "plausible"
  | "implausible"
  | "not_assessable";

/**
 * Check whether a claimed potency is plausible for a claimed development phase. PURE.
 *   - claimed phase >= CLINICAL_PHASE_THRESHOLD AND potency far weaker than the clinical
 *     ceiling (potencyNM > CLINICAL_POTENCY_CEILING_NM) → implausible
 *   - both present and consistent                        → plausible
 *   - either missing                                     → not_assessable
 */
export function assessPotencyPhase(
  potencyNM: number | null,
  phase: number | null
): { plausibility: PotencyPhasePlausibility; reason: string } {
  if (
    potencyNM === null ||
    !Number.isFinite(potencyNM) ||
    potencyNM <= 0 ||
    phase === null ||
    !Number.isFinite(phase)
  ) {
    return {
      plausibility: "not_assessable",
      reason:
        "Potency and/or development phase not provided, so potency-vs-phase plausibility could not be assessed.",
    };
  }

  if (phase >= CLINICAL_PHASE_THRESHOLD && potencyNM > CLINICAL_POTENCY_CEILING_NM) {
    return {
      plausibility: "implausible",
      reason: `A claimed clinical-phase (${phase}) compound with a primary potency of ${potencyNM} nM is implausibly weak (> ${CLINICAL_POTENCY_CEILING_NM} nM ceiling for a clinical-grade binder).`,
    };
  }

  return {
    plausibility: "plausible",
    reason: `A potency of ${potencyNM} nM is plausible for a phase-${phase} compound.`,
  };
}

// --- Roll-up --------------------------------------------------------------------

export interface DoseResponseSanityResult {
  monotonicity: Monotonicity;
  potencyPhase: PotencyPhasePlausibility;
  signal: FindingSignal;
  summary: string;
}

/**
 * Combine the two sanity checks into ONE engine signal, PURE and documented:
 *   - a non-monotone curve OR an implausible potency-vs-phase → overstated (the finding
 *     asserts a clean relationship the data doesn't support)
 *   - a monotone curve OR a plausible potency-vs-phase (and no flag) → positive
 *   - nothing assessable (too few points AND no potency/phase)      → empty
 */
export function combineDoseResponse(
  monotonicity: Monotonicity,
  potencyPhase: PotencyPhasePlausibility
): FindingSignal {
  const flagged =
    monotonicity === "non_monotone" || potencyPhase === "implausible";
  if (flagged) return "overstated";

  const monotoneOk =
    monotonicity === "monotone_increasing" ||
    monotonicity === "monotone_decreasing";
  const potencyOk = potencyPhase === "plausible";
  if (monotoneOk || potencyOk) return "positive";

  return "empty";
}

/**
 * Assess dose–response sanity for a finding. PURE — no network, no LLM. Given the
 * measured (dose,response) points and the optional claimed potency/phase, it checks
 * monotonicity + potency-vs-phase plausibility and rolls up one signal. Offline by
 * construction (pure input).
 */
export function verifyDoseResponseSanity(input: {
  points?: DoseResponsePoint[];
  claimedPotencyNM?: number | null;
  claimedPhase?: number | null;
}): DoseResponseSanityResult {
  const points = input.points ?? [];
  const potencyNM =
    typeof input.claimedPotencyNM === "number" ? input.claimedPotencyNM : null;
  const phase =
    typeof input.claimedPhase === "number" ? input.claimedPhase : null;

  const mono = assessMonotonicity(points);
  const pp = assessPotencyPhase(potencyNM, phase);
  const signal = combineDoseResponse(mono.monotonicity, pp.plausibility);

  const summary = [mono.reason, pp.reason].join(" ");

  return {
    monotonicity: mono.monotonicity,
    potencyPhase: pp.plausibility,
    signal,
    summary,
  };
}
