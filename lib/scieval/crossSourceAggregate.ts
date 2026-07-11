// Cross-source label AGGREGATION — the native TS step that MultiVerS never ships.
//
// MultiVerS (backend/engines/multivers/multivers/model.py::decode, label_lookup
// {0:CONTRADICT, 1:NEI, 2:SUPPORT}) scores ONE {claim, abstract} pair at a time and emits a
// single SUPPORTS / REFUTES / NEI label per abstract. lib/scieval/verify.ts is our faithful
// port of that per-abstract step. What MultiVerS leaves undone is COMBINING the per-abstract
// labels for the SAME claim into a claim-level verdict — there is no cross-source aggregation
// in the shipped pipeline. This module is that missing step, and it feeds the contradiction
// atlas: given per-source {label, confidence}, produce ONE aggregate verdict over the body of
// evidence.
//
// MOAT rule: NO LLM in the numeric / ranking / verdict path. Aggregation here is entirely
// deterministic — a confidence-weighted tally over the MultiVerS label taxonomy, classified
// by fixed thresholds. Claude only assigns the per-abstract labels upstream (verify.ts); the
// cross-source verdict is decided by rule. This is the exact TS mirror of
// backend/engines/multivers/papertrail_aggregate.py (same constants, same math, same
// classification), so the Python engine is a by-hand cross-check of this hot path.
//
// Label vocabulary is reused from lib/scieval/schemas.ts (ScievalLabel: SUPPORTS / REFUTES /
// NEI) — we do NOT redefine or edit that vocab here.

import { ScievalLabel } from "./schemas";

export type CrossSourceLabel = ScievalLabel;

// A source's single-abstract MultiVerS label plus the confidence that produced it. `id` is an
// opaque source identifier (used only for counting/deduping caller-side; never logged as text).
export interface CrossSourceInput {
  id: string;
  label: CrossSourceLabel;
  /** Confidence in the label, 0..1. Omitted => DEFAULT_CONFIDENCE (a full-strength vote). */
  confidence?: number;
}

// The claim-level aggregate verdict taxonomy — the 4-way collapse the atlas consumes.
export type CrossSourceVerdict = "supported" | "refuted" | "mixed" | "insufficient";

// Net direction of the directional (SUPPORTS+REFUTES) evidence, independent of magnitude.
export type NetDirection = "support" | "refute" | "none";

// The confidence-weighted masses behind the verdict (the auditable tally).
export interface CrossSourceTally {
  supportMass: number;
  refuteMass: number;
  neiMass: number;
}

// The grounded, deterministic aggregate returned to callers + the API route.
export interface CrossSourceAggregate {
  verdict: CrossSourceVerdict;
  supportCount: number;
  refuteCount: number;
  neiCount: number;
  // Signed net directional mass in [-1, 1]: +1 unanimous support, -1 unanimous refute, 0
  // balanced. Normalized by directional mass (NEI excluded — it makes no directional claim).
  netConfidence: number;
  // True exactly when directional evidence exists on BOTH sides and neither dominates.
  mixed: boolean;
  netDirection: NetDirection;
  tally: CrossSourceTally;
  // How many sources were supplied to aggregate.
  consideredCount: number;
}

// Deterministic tuning constants — FIXED, documented, identical to
// backend/engines/multivers/papertrail_aggregate.py so the Python cross-check and this hot
// path produce the same verdict by hand.

// A source with no confidence counts as a full-strength vote.
export const DEFAULT_CONFIDENCE = 1.0;

// The fraction of the directional (SUPPORTS+REFUTES) mass one side must hold to win outright.
// Below it, the two sides are treated as genuinely conflicting -> "mixed".
export const DOMINANCE_THRESHOLD = 0.7;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Read a source's confidence: default to DEFAULT_CONFIDENCE when omitted, clamp to [0, 1],
 * and treat a non-finite value as the default (the boundary Zod already guards, so this is a
 * belt-and-suspenders normalization matching the Python `_confidence_of`).
 */
function confidenceOf(source: CrossSourceInput): number {
  const raw = source.confidence;
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_CONFIDENCE;
  return clamp(raw, 0, 1);
}

/**
 * Deterministic verdict from the confidence-weighted masses. Pure and directly unit-testable.
 * Mirrors classify() in papertrail_aggregate.py.
 *
 * `mixed` is true exactly when directional evidence exists on BOTH sides and neither side
 * clears DOMINANCE_THRESHOLD.
 */
export function classify(
  supportMass: number,
  refuteMass: number
): { verdict: CrossSourceVerdict; mixed: boolean } {
  const directional = supportMass + refuteMass;
  // No directional evidence at all (only NEI, or nothing) -> honest insufficient.
  if (directional <= 0) {
    return { verdict: "insufficient", mixed: false };
  }

  const supportShare = supportMass / directional;
  const refuteShare = refuteMass / directional;
  const bothSides = supportMass > 0 && refuteMass > 0;

  if (supportShare >= DOMINANCE_THRESHOLD) return { verdict: "supported", mixed: false };
  if (refuteShare >= DOMINANCE_THRESHOLD) return { verdict: "refuted", mixed: false };

  // Directional mass present, but neither side dominates -> genuine conflict.
  return { verdict: "mixed", mixed: bothSides };
}

/**
 * Aggregate per-source MultiVerS labels into ONE claim-level verdict. Deterministic:
 *   1. Each source contributes its confidence to its label's weighted mass. SUPPORTS/REFUTES
 *      drive the directional masses; NEI accumulates the NEI mass only and never nudges the
 *      support/refute direction (a "not enough info" abstract makes no directional claim).
 *   2. classify() turns the masses into supported | refuted | mixed | insufficient.
 *   3. netConfidence is the signed, directional-mass-normalized net direction in [-1, 1].
 *
 * Honest abstention: an all-NEI or empty body of evidence is "insufficient", never a forced
 * directional verdict (mirrors MultiVerS's own NEI class + PaperTrail's insufficient rule).
 *
 * Pure — no network, no LLM — so it is directly unit-testable and matches the Python engine.
 */
export function aggregateCrossSource(
  perSource: readonly CrossSourceInput[]
): CrossSourceAggregate {
  let supportMass = 0;
  let refuteMass = 0;
  let neiMass = 0;
  let supportCount = 0;
  let refuteCount = 0;
  let neiCount = 0;

  for (const source of perSource) {
    const confidence = confidenceOf(source);
    switch (source.label) {
      case "SUPPORTS":
        supportMass += confidence;
        supportCount += 1;
        break;
      case "REFUTES":
        refuteMass += confidence;
        refuteCount += 1;
        break;
      case "NEI":
        neiMass += confidence;
        neiCount += 1;
        break;
    }
  }

  const { verdict, mixed } = classify(supportMass, refuteMass);

  const directional = supportMass + refuteMass;
  const netConfidence = directional > 0 ? (supportMass - refuteMass) / directional : 0;

  const netDirection: NetDirection =
    netConfidence > 0 ? "support" : netConfidence < 0 ? "refute" : "none";

  return {
    verdict,
    supportCount,
    refuteCount,
    neiCount,
    netConfidence,
    mixed,
    netDirection,
    tally: { supportMass, refuteMass, neiMass },
    consideredCount: perSource.length,
  };
}
