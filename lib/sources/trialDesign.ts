// TRIAL DESIGN: deterministic ELIGIBILITY-GATE parsing + DESIGN-CREDIBILITY priors.
//
// This is the native TypeScript twin of
// backend/engines/pytrials/papertrail_design.py. It gives PaperTrail two things the
// upstream pytrials client does not: a deterministic split of a trial's free-text
// eligibility blob into inclusion/exclusion GATES, and a deterministic CREDIBILITY
// PRIOR derived from a trial's structured design fields (randomized? blinded? big
// enough? late enough phase?).
//
// MOAT: there is NO LLM anywhere in this file. The parse is pure string work; the
// credibility score is a pure, documented function of the structured fields. The same
// input always yields the same gates, tier, prior weight, and factors — exactly what a
// provenance/verification tool must guarantee. The prior weight is a SUPPORTING weight
// on a trial's design strength; it never decides a verdict by itself.
//
// The eligibility split intentionally follows the same heading/bullet rules as
// lib/trialMatcher/eligibility.ts::parseEligibility (which is used inside the patient
// matcher). This module keeps its own copy so the design/credibility feature is
// self-contained and can evolve independently, but the two are behaviourally aligned.

// --- Rubric constants (single source of truth; mirror papertrail_design.py) ---------

// Enrollment size bands (participant counts, inclusive lower bounds).
export const LARGE_ENROLLMENT = 1000;
export const MEDIUM_ENROLLMENT = 300;
export const SMALL_ENROLLMENT = 50;

// Points awarded per structured design factor.
const RANDOMIZED_POINTS = 2;
const BLINDING_DOUBLE_POINTS = 2;
const BLINDING_SINGLE_POINTS = 1;
const ENROLLMENT_LARGE_POINTS = 3;
const ENROLLMENT_MEDIUM_POINTS = 2;
const ENROLLMENT_SMALL_POINTS = 1;
const PHASE_LATE_POINTS = 2;
const PHASE_MID_POINTS = 1;

// Tier cut-offs over the summed points (max 9) and their prior weights.
const HIGH_CUTOFF = 7;
const MODERATE_CUTOFF = 4;
const LOW_CUTOFF = 2;

export type DesignCredibilityTier = "high" | "moderate" | "low" | "very_low";

const PRIOR_WEIGHT_BY_TIER: Record<DesignCredibilityTier, number> = {
  high: 1.0,
  moderate: 0.7,
  low: 0.4,
  very_low: 0.2,
};

const TIER_LABEL: Record<DesignCredibilityTier, string> = {
  high: "high design credibility",
  moderate: "moderate design credibility",
  low: "low design credibility",
  very_low: "very low design credibility",
};

// --- Eligibility parsing (deterministic; aligned with trialMatcher/eligibility.ts) ---

const INCLUSION_HEADING = /inclusion\s+criteria\s*:?/i;
const EXCLUSION_HEADING = /exclusion\s+criteria\s*:?/i;

export interface EligibilityGates {
  inclusion: string[];
  exclusion: string[];
}

// Strip a leading bullet/number marker and surrounding whitespace from a criterion line.
function cleanCriterion(line: string): string {
  return line.replace(/^\s*(?:[-*•·‣▪◦]|\d+[.)]|[a-z][.)]|\([a-z0-9]+\))\s*/i, "").trim();
}

// Split a block of text into individual criterion strings on newlines and bullet markers.
function splitCriteria(block: string): string[] {
  return block
    .split(/\r?\n|(?=\s[-*•·‣▪◦]\s)/)
    .map(cleanCriterion)
    .filter((c) => c.length > 0);
}

/**
 * Split a free-text eligibility blob into inclusion/exclusion gates.
 *
 * Pure string work — NO LLM. Registries write the blob in a few common layouts: an
 * "Inclusion Criteria:" heading with bullets, then "Exclusion Criteria:", or plain
 * newline lists. We split on the headings, then on bullets/newlines, and strip bullet
 * markers. Anything before the first recognized heading is treated as inclusion
 * context. A non-string/empty input yields two empty arrays (honest "no gates").
 */
export function parseEligibility(raw: string): EligibilityGates {
  if (!raw || raw.trim().length === 0) {
    return { inclusion: [], exclusion: [] };
  }

  const exclMatch = raw.match(EXCLUSION_HEADING);
  const inclMatch = raw.match(INCLUSION_HEADING);

  // No exclusion heading: everything is inclusion (drop a leading inclusion heading).
  if (!exclMatch || exclMatch.index === undefined) {
    const body = inclMatch ? raw.slice((inclMatch.index ?? 0) + inclMatch[0].length) : raw;
    return { inclusion: splitCriteria(body), exclusion: [] };
  }

  const exclStart = exclMatch.index;
  // Inclusion block: from just after the inclusion heading (or start) up to the
  // exclusion heading. Anything before the first heading is inclusion context.
  const inclHeadingEnd =
    inclMatch && inclMatch.index !== undefined && inclMatch.index < exclStart
      ? inclMatch.index + inclMatch[0].length
      : 0;
  const inclusionBlock = raw.slice(inclHeadingEnd, exclStart);
  const exclusionBlock = raw.slice(exclStart + exclMatch[0].length);

  return {
    inclusion: splitCriteria(inclusionBlock),
    exclusion: splitCriteria(exclusionBlock),
  };
}

// --- Design credibility scoring (deterministic; NO LLM) -----------------------------

// Normalized blinding buckets. The registry uses many spellings; we collapse them.
type BlindingBucket = "double" | "single" | "open";

export interface DesignFieldsInput {
  randomized?: boolean | null;
  blinding?: string | null;
  enrollment?: number | null;
  phase?: string | null;
}

export interface DesignCredibility {
  tier: DesignCredibilityTier;
  tierLabel: string;
  priorWeight: number;
  points: number;
  factors: string[];
}

// Collapse the many registry blinding spellings to double/single/open, or null.
function normalizeBlinding(value: string | null | undefined): BlindingBucket | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "") return null;
  if (text.includes("double") || text.includes("triple") || text.includes("quadruple")) {
    return "double";
  }
  if (text.includes("single")) return "single";
  if (
    text.includes("open") ||
    text.includes("none") ||
    text.includes("no masking") ||
    text.includes("unmask")
  ) {
    return "open";
  }
  // An unrecognized non-empty masking string is treated as open (no credit granted).
  return "open";
}

function normalizePhase(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toUpperCase();
  return text.length > 0 ? text : null;
}

// Coerce a possibly-null/float enrollment to a non-negative integer, or null.
function normalizeEnrollment(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n < 0 ? null : n;
}

function normalizeRandomized(value: boolean | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function blindingPoints(blinding: BlindingBucket | null): { points: number; factor: string } {
  if (blinding === "double") return { points: BLINDING_DOUBLE_POINTS, factor: "double-blind (or greater)" };
  if (blinding === "single") return { points: BLINDING_SINGLE_POINTS, factor: "single-blind" };
  if (blinding === "open") return { points: 0, factor: "open-label (no blinding)" };
  return { points: 0, factor: "blinding not reported" };
}

function enrollmentPoints(enrollment: number | null): { points: number; factor: string } {
  if (enrollment === null) return { points: 0, factor: "enrollment not reported" };
  if (enrollment >= LARGE_ENROLLMENT) {
    return { points: ENROLLMENT_LARGE_POINTS, factor: `large enrollment (${enrollment})` };
  }
  if (enrollment >= MEDIUM_ENROLLMENT) {
    return { points: ENROLLMENT_MEDIUM_POINTS, factor: `moderate enrollment (${enrollment})` };
  }
  if (enrollment >= SMALL_ENROLLMENT) {
    return { points: ENROLLMENT_SMALL_POINTS, factor: `small enrollment (${enrollment})` };
  }
  return { points: 0, factor: `very small enrollment (${enrollment})` };
}

function phasePoints(phase: string | null): { points: number; factor: string } {
  if (phase === null) return { points: 0, factor: "phase not reported" };
  if (phase.includes("PHASE4") || phase.includes("PHASE3")) {
    return { points: PHASE_LATE_POINTS, factor: "late-phase confirmatory (Phase 3/4)" };
  }
  if (phase.includes("PHASE2")) return { points: PHASE_MID_POINTS, factor: "mid-phase (Phase 2)" };
  if (phase.includes("PHASE1") || phase.includes("EARLY_PHASE1")) {
    return { points: 0, factor: "early-phase (Phase 1)" };
  }
  return { points: 0, factor: "non-standard phase" };
}

function tierForPoints(points: number): DesignCredibilityTier {
  if (points >= HIGH_CUTOFF) return "high";
  if (points >= MODERATE_CUTOFF) return "moderate";
  if (points >= LOW_CUTOFF) return "low";
  return "very_low";
}

/**
 * Deterministically score a trial's design credibility from its structured design
 * fields. Pure function — NO LLM, no I/O. Sums transparent per-factor points, bins
 * them to a tier, and reports the factors that moved the score. Returns a NEW object.
 *
 * The prior weight is what a synthesis step multiplies a trial's design-derived
 * evidence contribution by. It is a supporting weight only — it never decides a
 * verdict by itself.
 */
export function scoreDesignCredibility(fields: DesignFieldsInput): DesignCredibility {
  const randomized = normalizeRandomized(fields.randomized);
  const blinding = normalizeBlinding(fields.blinding);
  const enrollment = normalizeEnrollment(fields.enrollment);
  const phase = normalizePhase(fields.phase);

  const factors: string[] = [];
  let points = 0;

  if (randomized === true) {
    points += RANDOMIZED_POINTS;
    factors.push("randomized allocation");
  } else if (randomized === false) {
    factors.push("non-randomized allocation");
  } else {
    factors.push("randomization not reported");
  }

  const b = blindingPoints(blinding);
  points += b.points;
  factors.push(b.factor);

  const e = enrollmentPoints(enrollment);
  points += e.points;
  factors.push(e.factor);

  const p = phasePoints(phase);
  points += p.points;
  factors.push(p.factor);

  const tier = tierForPoints(points);
  return {
    tier,
    tierLabel: TIER_LABEL[tier],
    priorWeight: PRIOR_WEIGHT_BY_TIER[tier],
    points,
    factors,
  };
}
