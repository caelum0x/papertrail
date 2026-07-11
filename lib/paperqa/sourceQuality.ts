// PaperTrail-native source-quality tiering — the TypeScript twin of
// backend/engines/paper-qa/papertrail_source_quality.py. paper-qa's synthesis treats
// every retrieved passage as equally trustworthy once it clears retrieval; PaperTrail
// cannot. A claim "confirmed" by a retracted paper or an unreviewed preprint is not
// confirmed. This module assigns each source a QUALITY TIER (A/B/C/D) and a QUALITY
// WEIGHT in [0, 1] from its metadata alone, so lib/paperqa/ask.ts synthesis can
// DOWN-WEIGHT low-tier evidence instead of counting it at face value.
//
// NO LLM anywhere in this path: tier and weight are a pure, documented function of the
// metadata. The same metadata always yields the same result — the determinism a
// provenance tool must guarantee. The numeric rubric mirrors the Python constants
// field-for-field (WELL_CITED_THRESHOLD, PREPRINT_CITED_THRESHOLD, BASE_WEIGHT_BY_TIER,
// OPEN_ACCESS_BONUS) so the CLI and the app agree on every score.

export type SourceQualityTier = "A" | "B" | "C" | "D";

// Raw source metadata as accepted at the boundary. Every field beyond `id` is
// optional and defensively narrowed — external data is never trusted.
export interface SourceQualityMeta {
  id: string;
  journal?: string | null;
  year?: number | null;
  citations?: number | null;
  is_preprint?: boolean | null;
  is_open_access?: boolean | null;
  retracted?: boolean | null;
  /** A Retraction Watch id present here hard-caps the source to untrusted (Tier D). */
  retraction_watch_id?: string | null;
}

export interface SourceQualityResult {
  id: string;
  tier: SourceQualityTier;
  tierLabel: string;
  /** Multiplier synthesis applies to this source's evidence. In [0, 1]. */
  weight: number;
  retracted: boolean;
  rationale: string;
}

// --- Rubric constants (mirror papertrail_source_quality.py exactly) ---

/** Journal-article citations at/above this promote a peer-reviewed source B -> A. */
export const WELL_CITED_THRESHOLD = 100;
/** Preprint/unknown citations at/above this promote C -> B (capped at B — never reviewed). */
export const PREPRINT_CITED_THRESHOLD = 50;

const BASE_WEIGHT_BY_TIER: Record<SourceQualityTier, number> = {
  A: 1.0,
  B: 0.8,
  C: 0.5,
  D: 0.0,
};

/** Additive weight bonus for open access, on non-D tiers only. */
export const OPEN_ACCESS_BONUS = 0.05;

const TIER_LABEL: Record<SourceQualityTier, string> = {
  A: "peer-reviewed, well-cited",
  B: "peer-reviewed",
  C: "preprint or unreviewed",
  D: "untrusted",
};

// Normalized, fully-narrowed metadata used internally by the scorer.
interface NormalizedMeta {
  id: string;
  journal: string | null;
  citations: number;
  isPreprint: boolean;
  isOpenAccess: boolean;
  retracted: boolean;
  retractionWatchId: string | null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Non-negative integer citation count; anything invalid (NaN, negative, bool, etc.)
// deterministically becomes 0 rather than throwing — a missing count is not a failure.
function asNonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const n = Math.trunc(value);
  return n < 0 ? 0 : n;
}

function asBool(value: unknown): boolean {
  return value === true;
}

// Round to 4 decimals and clamp to [0, 1], mirroring the Python _clamp01.
function clamp01(value: number): number {
  const rounded = Math.round(value * 10000) / 10000;
  if (rounded < 0) return 0;
  if (rounded > 1) return 1;
  return rounded;
}

function normalizeMeta(meta: SourceQualityMeta): NormalizedMeta {
  const retractionWatchId = asOptionalString(meta.retraction_watch_id);
  return {
    id: meta.id,
    journal: asOptionalString(meta.journal),
    citations: asNonNegInt(meta.citations),
    isPreprint: asBool(meta.is_preprint),
    isOpenAccess: asBool(meta.is_open_access),
    // A Retraction Watch id is itself proof of retraction, so it OR's into the flag.
    retracted: asBool(meta.retracted) || retractionWatchId !== null,
    retractionWatchId,
  };
}

/**
 * Deterministically tier one source and compute its quality weight.
 *
 * Pure function of `meta` — no LLM, no I/O. A retracted source (explicit flag or a
 * Retraction Watch id) hard-caps to Tier D / weight 0 regardless of any other signal.
 * Returns a NEW result object; the input is not mutated. Mirrors `score_source` in
 * papertrail_source_quality.py field-for-field.
 */
export function scoreSourceQuality(meta: SourceQualityMeta): SourceQualityResult {
  const n = normalizeMeta(meta);

  // HARD CAP: retracted -> Tier D, weight 0.0, regardless of any other signal.
  if (n.retracted) {
    const why =
      n.retractionWatchId !== null
        ? `Retraction Watch id ${n.retractionWatchId}`
        : "flagged retracted";
    return {
      id: n.id,
      tier: "D",
      tierLabel: TIER_LABEL.D,
      weight: 0.0,
      retracted: true,
      rationale: `Untrusted (Tier D): ${why}; a retracted source cannot support a claim.`,
    };
  }

  const isPeerReviewed = n.journal !== null && !n.isPreprint;

  let tier: SourceQualityTier;
  let rationale: string;

  if (isPeerReviewed) {
    if (n.citations >= WELL_CITED_THRESHOLD) {
      tier = "A";
      rationale = `Peer-reviewed journal (${n.journal}) with ${n.citations} citations (>= ${WELL_CITED_THRESHOLD}): promoted to Tier A.`;
    } else {
      tier = "B";
      rationale = `Peer-reviewed journal (${n.journal}) with ${n.citations} citations: Tier B.`;
    }
  } else {
    const venue = n.isPreprint ? "Preprint" : "Unknown venue (no journal metadata)";
    if (n.citations >= PREPRINT_CITED_THRESHOLD) {
      tier = "B";
      rationale = `${venue} but well cited (${n.citations} >= ${PREPRINT_CITED_THRESHOLD}): promoted to Tier B; capped there — never formally peer reviewed.`;
    } else {
      tier = "C";
      rationale = `${venue} with ${n.citations} citations: Tier C (down-weighted, unreviewed evidence).`;
    }
  }

  let weight = BASE_WEIGHT_BY_TIER[tier];
  if (n.isOpenAccess) {
    weight = clamp01(weight + OPEN_ACCESS_BONUS);
    rationale += " Open-access bonus applied to weight.";
  }

  return {
    id: n.id,
    tier,
    tierLabel: TIER_LABEL[tier],
    weight: clamp01(weight),
    retracted: false,
    rationale,
  };
}

/**
 * Tier a batch of sources. Returns a NEW array in input order; no source is dropped
 * (a low-quality source is DOWN-WEIGHTED, not discarded — its tier tells the caller
 * how far to trust it).
 */
export function scoreSourceQualityBatch(
  metas: readonly SourceQualityMeta[]
): SourceQualityResult[] {
  return metas.map((meta) => scoreSourceQuality(meta));
}
