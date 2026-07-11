// "WHY THIS RANK" — a deterministic, scannable one-line eligibility summary computed
// PURELY from the per-criterion assessments already produced by eligibility.ts. No LLM,
// no network, no mutation: given the same criteria it always yields the same summary.
//
// This exists so a coordinator can see WHY a trial ranks where it does at a glance — e.g.
// "3/4 inclusion met · 0 exclusions triggered · 1 unknown" — before expanding the full
// inclusion/exclusion breakdown. It mirrors the exact semantics the scorer uses:
//
//   * INCLUSION "met"      => the patient satisfies a required inclusion (favourable).
//   * EXCLUSION "met"      => the patient MEETS the exclusion => they'd be EXCLUDED
//                            (a "triggered" exclusion — the disqualifying case).
//   * "unknown" (either)   => the profile is silent; honest gap, not a guess.
//
// It makes NO claim the criteria don't already support: it only counts and phrases them.

import type { CriterionAssessment } from "./schemas";

// The raw tallies behind the summary — exposed so callers (or tests) can assert the exact
// counts, and so the UI can style the disqualifying case (exclusionsTriggered > 0) distinctly.
export interface RankSummary {
  inclusionMet: number; // inclusion criteria the patient satisfies
  inclusionTotal: number; // total inclusion criteria assessed
  exclusionsTriggered: number; // exclusion criteria the patient MEETS (=> would be excluded)
  exclusionTotal: number; // total exclusion criteria assessed
  unknown: number; // criteria (either type) the profile could not resolve
  // A short, human-readable one-liner assembled from the counts above. Never empty when
  // there is at least one criterion; the empty-criteria case is handled by the caller.
  text: string;
}

// Join only the non-empty parts with a middle dot, matching the console's inline-meta style.
function joinParts(parts: readonly string[]): string {
  return parts.filter((p) => p.length > 0).join(" · ");
}

/**
 * Compute a deterministic "why this rank" summary from a trial's criterion assessments.
 *
 * Pure and total: safe to call with an empty array (returns all-zero counts and a neutral
 * "No parsed criteria." line). The wording mirrors the scorer's semantics exactly so the
 * one-liner can never contradict the detailed breakdown or the verdict badge beside it.
 */
export function summariseRank(criteria: readonly CriterionAssessment[]): RankSummary {
  const inclusion = criteria.filter((c) => c.type === "inclusion");
  const exclusion = criteria.filter((c) => c.type === "exclusion");

  const inclusionMet = inclusion.filter((c) => c.assessment === "met").length;
  const inclusionTotal = inclusion.length;

  // An exclusion is "triggered" when the patient MEETS it (assessment === "met") — that is
  // the disqualifying case in the scorer.
  const exclusionsTriggered = exclusion.filter((c) => c.assessment === "met").length;
  const exclusionTotal = exclusion.length;

  const unknown = criteria.filter((c) => c.assessment === "unknown").length;

  if (criteria.length === 0) {
    return {
      inclusionMet: 0,
      inclusionTotal: 0,
      exclusionsTriggered: 0,
      exclusionTotal: 0,
      unknown: 0,
      text: "No parsed criteria.",
    };
  }

  const parts: string[] = [];
  if (inclusionTotal > 0) {
    parts.push(`${inclusionMet}/${inclusionTotal} inclusion met`);
  }
  parts.push(
    exclusionsTriggered === 1
      ? "1 exclusion triggered"
      : `${exclusionsTriggered} exclusions triggered`
  );
  if (unknown > 0) {
    parts.push(unknown === 1 ? "1 unknown" : `${unknown} unknown`);
  }

  return {
    inclusionMet,
    inclusionTotal,
    exclusionsTriggered,
    exclusionTotal,
    unknown,
    text: joinParts(parts),
  };
}
