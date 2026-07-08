// Shared trust-score banding. A single source of truth for turning a 0–100 trust
// score into a categorical band, a human label, and Tailwind presentation classes,
// so every surface in the UI agrees on where "high" ends and "low" begins. Pure:
// no mutation, no side effects. Out-of-range scores are clamped defensively rather
// than trusted, since scores can arrive from an LLM-derived pipeline.

export type TrustBand = "high" | "moderate" | "low";

// Band cut points, as inclusive lower bounds on the clamped 0–100 score.
const HIGH_MIN = 90;
const MODERATE_MIN = 60;

/** Clamp an arbitrary number into the valid 0–100 score range. */
function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

/**
 * Band a trust score: >=90 high, >=60 moderate, else low. Scores outside 0–100
 * are clamped before banding, so a stray 120 lands in "high" and a -5 in "low".
 */
export function trustBand(score: number): TrustBand {
  const clamped = clampScore(score);
  if (clamped >= HIGH_MIN) return "high";
  if (clamped >= MODERATE_MIN) return "moderate";
  return "low";
}

/** The user-facing label for a band, phrased as claim-vs-source drift. */
export function trustBandLabel(band: TrustBand): string {
  switch (band) {
    case "high":
      return "Likely accurate";
    case "moderate":
      return "Minor drift";
    case "low":
      return "Significant drift";
  }
}

/** Tailwind classes (background + text + border) for rendering a band. */
export function trustBandClasses(band: TrustBand): string {
  switch (band) {
    case "high":
      return "bg-green-50 text-green-700 border-green-200";
    case "moderate":
      return "bg-yellow-50 text-yellow-800 border-yellow-200";
    case "low":
      return "bg-red-50 text-red-700 border-red-200";
  }
}
