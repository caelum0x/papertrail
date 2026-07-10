// Deterministic verification against a trial's REGISTERED statistical results.
// This is the part a generic LLM claim-checker cannot do: instead of asking a model
// to compare two blobs of text, we compare the claim's stated effect against the
// sponsor-reported effect estimate from ClinicalTrials.gov's structured resultsSection
// (paramValue, CI, p-value) — ground truth that cannot be fabricated. No LLM in the loop.

import { TrialResultAnalysis } from "./sources/clinicaltrials";
import { claimedReductionPercent } from "./effectSize";
import {
  verifyAgainstSubgroups,
  type Subgroup,
  type SubgroupCheck,
} from "./subgroupAnalysis";

export type RegistryVerdict =
  | "matches_registry" // claim's magnitude agrees with the registered primary result
  | "overstates_registry" // claim's effect is materially larger than registered
  | "understates_registry" // claim's effect is materially smaller than registered
  | "significance_mismatch" // claim asserts benefit but registered CI crosses the null
  | "secondary_endpoint_match" // claim matches a SECONDARY outcome, not the primary
  | "no_registered_results" // trial has no posted results to check against
  | "not_comparable"; // results exist but no comparable numeric claim/measure

export interface RegistryCheck {
  verdict: RegistryVerdict;
  rationale: string;
  /** The specific registered analysis we checked against (for the citation trail). */
  primaryAnalysis: TrialResultAnalysis | null;
  claimedReductionPercent: number | null;
  registeredReductionPercent: number | null;
  /** Raw-count-derived stats from the registry (percentage points / count), when available. */
  absoluteRiskReduction: number | null;
  numberNeededToTreat: number | null;
  /**
   * Optional subgroup-primacy hardening. Populated only when the caller supplies
   * subgroup structure + provenance to `checkAgainstRegistry`; otherwise null.
   * Additive — never affects the registry `verdict` above.
   */
  subgroupPrimacy: SubgroupPrimacyCheck | null;
}

// Optional subgroup context for the additive subgroup-cited-as-primary check.
export interface SubgroupContext {
  subgroups: readonly Subgroup[];
  provenance: readonly SubgroupProvenance[];
}

// Claimed effect must exceed the registered effect by this factor to be "overstated".
const OVERSTATE_FACTOR = 1.5;

function isRatioMeasure(paramType: string | null): boolean {
  if (!paramType) return false;
  const p = paramType.toLowerCase();
  return (
    p.includes("hazard ratio") ||
    p.includes("odds ratio") ||
    p.includes("risk ratio") ||
    p.includes("rate ratio") ||
    p.includes("relative risk") ||
    /\b(hr|or|rr)\b/.test(p)
  );
}

/** The relative reduction (%) implied by a registered ratio estimate, e.g. HR 0.75 -> 25. */
function ratioToReductionPercent(value: number): number {
  return (1 - value) * 100;
}

/** True when a ratio analysis's CI spans the null value of 1 (not statistically significant). */
function ciCrossesNull(a: TrialResultAnalysis): boolean {
  if (a.ciLower === null || a.ciUpper === null) return false;
  return a.ciLower <= 1 && a.ciUpper >= 1;
}

const BENEFIT_RE =
  /\b(reduc\w*|lower\w*|cut\w*|decreas\w*|improv\w*|effective|benefit\w*|prevent\w*|halv\w*|cuts?\b)/i;

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function describe(a: TrialResultAnalysis): string {
  const ci =
    a.ciLower !== null && a.ciUpper !== null ? ` (${a.ciPct ?? 95}% CI ${a.ciLower}–${a.ciUpper})` : "";
  const p = a.pValue ? `, p=${a.pValue}` : "";
  return `${a.paramType} ${a.paramValue}${ci}${p}`;
}

/** Two relative-reduction magnitudes agree if neither materially exceeds the other. */
function magnitudesClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return Math.abs(a - b) < 5;
  return a <= b * OVERSTATE_FACTOR && b <= a * OVERSTATE_FACTOR;
}

/** The relative reduction (%) implied by a ratio analysis, or null if not a usable ratio. */
function ratioReduction(a: TrialResultAnalysis): number | null {
  if (!isRatioMeasure(a.paramType) || a.paramValue === null) return null;
  return ratioToReductionPercent(a.paramValue);
}

/** A sentence describing the raw-count-derived absolute stats, when available. */
function absoluteStatsText(a: TrialResultAnalysis): string {
  if (a.absoluteRiskReduction === null || a.absoluteRiskReduction === undefined) return "";
  const nnt = a.numberNeededToTreat != null ? `, NNT ${Math.round(a.numberNeededToTreat)}` : "";
  return ` The registered raw counts give an absolute risk reduction of ${round(a.absoluteRiskReduction)} percentage points${nnt}.`;
}

/**
 * Check a claim against a trial's registered results. Deterministic and defensible:
 * fires only on the rule-decidable cases and cites the exact registered analysis,
 * including the sponsor's raw-count absolute risk reduction / NNT when available, and
 * detects when a claim's effect matches a secondary — not the primary — endpoint.
 */
type RegistryCheckCore = Omit<RegistryCheck, "subgroupPrimacy">;

function checkAgainstRegistryCore(
  claim: string,
  analyses: TrialResultAnalysis[]
): RegistryCheckCore {
  if (analyses.length === 0) {
    return {
      verdict: "no_registered_results",
      rationale: "This trial has no results posted to ClinicalTrials.gov, so there is no registered statistic to check the claim against.",
      primaryAnalysis: null,
      claimedReductionPercent: null,
      registeredReductionPercent: null,
      absoluteRiskReduction: null,
      numberNeededToTreat: null,
    };
  }

  // Prefer a primary ratio outcome with a usable point estimate.
  const primary =
    analyses.find((a) => a.outcomeType === "PRIMARY" && isRatioMeasure(a.paramType) && a.paramValue !== null) ??
    analyses.find((a) => isRatioMeasure(a.paramType) && a.paramValue !== null) ??
    analyses[0];

  const arr = primary.absoluteRiskReduction ?? null;
  const nnt = primary.numberNeededToTreat ?? null;

  if (!isRatioMeasure(primary.paramType) || primary.paramValue === null) {
    return {
      verdict: "not_comparable",
      rationale: `The registered primary analysis (${describe(primary)}) isn't a ratio effect this checker can reconcile numerically; deferring rather than guessing.`,
      primaryAnalysis: primary,
      claimedReductionPercent: null,
      registeredReductionPercent: null,
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  const registeredReduction = ratioToReductionPercent(primary.paramValue);
  const claimedReduction = claimedReductionPercent(claim);
  const assertsBenefit = BENEFIT_RE.test(claim);

  // Significance: the claim asserts a benefit but the registered CI includes the null.
  if (assertsBenefit && ciCrossesNull(primary)) {
    return {
      verdict: "significance_mismatch",
      rationale: `The claim asserts a benefit, but the registered primary result ${describe(primary)} has a confidence interval that crosses 1 (not statistically significant).`,
      primaryAnalysis: primary,
      claimedReductionPercent: claimedReduction,
      registeredReductionPercent: round(registeredReduction),
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  if (claimedReduction === null) {
    return {
      verdict: "not_comparable",
      rationale: `Registered primary result: ${describe(primary)} (≈${round(registeredReduction)}% reduction).${absoluteStatsText(primary)} The claim states no comparable numeric effect to reconcile.`,
      primaryAnalysis: primary,
      claimedReductionPercent: null,
      registeredReductionPercent: round(registeredReduction),
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  // Endpoint switch: the claim doesn't match the PRIMARY outcome, but does match a
  // SECONDARY one — a common distortion (citing a secondary finding as the headline result).
  if (!magnitudesClose(claimedReduction, registeredReduction)) {
    const secondary = analyses.find(
      (a) =>
        a !== primary &&
        a.outcomeType !== "PRIMARY" &&
        ratioReduction(a) !== null &&
        magnitudesClose(claimedReduction, ratioReduction(a) as number)
    );
    if (secondary) {
      return {
        verdict: "secondary_endpoint_match",
        rationale: `The claim's ~${round(claimedReduction)}% reduction does not match the trial's PRIMARY result (${describe(primary)}, ≈${round(registeredReduction)}%), but it matches a SECONDARY outcome — "${secondary.outcomeTitle}" (${describe(secondary)}). A secondary/exploratory finding shouldn't be presented as the trial's headline result.`,
        primaryAnalysis: primary,
        claimedReductionPercent: round(claimedReduction),
        registeredReductionPercent: round(registeredReduction),
        absoluteRiskReduction: arr,
        numberNeededToTreat: nnt,
      };
    }
  }

  if (registeredReduction > 0 && claimedReduction > registeredReduction * OVERSTATE_FACTOR) {
    return {
      verdict: "overstates_registry",
      rationale: `The claim implies a ~${round(claimedReduction)}% reduction, but the registered primary result is ${describe(primary)} — about a ${round(registeredReduction)}% reduction.${absoluteStatsText(primary)} The claim overstates the trial's own registered effect.`,
      primaryAnalysis: primary,
      claimedReductionPercent: round(claimedReduction),
      registeredReductionPercent: round(registeredReduction),
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  if (registeredReduction > 0 && claimedReduction * OVERSTATE_FACTOR < registeredReduction) {
    return {
      verdict: "understates_registry",
      rationale: `The claim implies a ~${round(claimedReduction)}% reduction, but the registered primary result is ${describe(primary)} — about a ${round(registeredReduction)}% reduction.${absoluteStatsText(primary)} The claim understates the registered effect.`,
      primaryAnalysis: primary,
      claimedReductionPercent: round(claimedReduction),
      registeredReductionPercent: round(registeredReduction),
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  return {
    verdict: "matches_registry",
    rationale: `The claim's ~${round(claimedReduction)}% reduction agrees with the registered primary result: ${describe(primary)} (≈${round(registeredReduction)}% reduction).${absoluteStatsText(primary)}`,
    primaryAnalysis: primary,
    claimedReductionPercent: round(claimedReduction),
    registeredReductionPercent: round(registeredReduction),
    absoluteRiskReduction: arr,
    numberNeededToTreat: nnt,
  };
}

/**
 * Check a claim against a trial's registered results (see `checkAgainstRegistryCore`
 * for the registry-verdict logic). This wrapper is strictly additive: it preserves
 * the original two-argument behaviour and, when the caller ALSO supplies subgroup
 * structure + provenance, attaches the deterministic subgroup-cited-as-primary
 * hardening under `subgroupPrimacy`. The subgroup check NEVER changes the registry
 * `verdict` — it is surfaced alongside it. Pure; no LLM in the loop.
 */
export function checkAgainstRegistry(
  claim: string,
  analyses: TrialResultAnalysis[],
  subgroupContext?: SubgroupContext
): RegistryCheck {
  const base = checkAgainstRegistryCore(claim, analyses);
  const subgroupPrimacy =
    subgroupContext && subgroupContext.subgroups.length > 0
      ? checkSubgroupCitedAsPrimary(claim, subgroupContext.subgroups, subgroupContext.provenance)
      : null;
  return { ...base, subgroupPrimacy };
}

// ---------------------------------------------------------------------------
// Subgroup-cited-as-primary hardening.
//
// A distinct, higher-severity distortion than "the claim rests on a subgroup":
// a claim that quotes a SUBGROUP effect and presents it as the PRIMARY /
// whole-population result, when that subgroup finding is not credible enough to
// be a primary conclusion — because it was POST-HOC (not pre-specified) and/or
// the formal test for subgroup differences (the interaction test) is NOT
// significant. Regulatory guidance (FDA/EMA, ICH E9) treats a post-hoc or
// non-interaction-supported subgroup effect as hypothesis-generating, never as
// the trial's headline finding.
//
// This wires the existing deterministic subgroup engine (verifyAgainstSubgroups,
// which runs the between-groups interaction test) and layers the pre-specified /
// interaction-p provenance the registry cannot encode — all rule-decided, no LLM.
// ---------------------------------------------------------------------------

// Alpha below which the test for subgroup differences (interaction) is deemed to
// support a genuine, non-spurious subgroup effect. Mirrors the engine's 0.05.
const INTERACTION_ALPHA = 0.05;

// Per-subgroup provenance the trial registry does not carry: whether the subgroup
// was PRE-SPECIFIED in the protocol/SAP, and — when reported — the interaction
// (test-for-subgroup-differences) p-value for that split. Both are honest,
// caller-declared inputs from protocol/publication appraisal.
export interface SubgroupProvenance {
  name: string;
  prespecified: boolean;
  interactionPValue?: number | null;
}

export type SubgroupPrimacyVerdict =
  | "subgroup_cited_as_primary" // claim quotes a weak subgroup effect as the primary/whole-population result
  | "subgroup_effect_credible" // the matched subgroup is pre-specified AND interaction-supported
  | "reflects_overall_effect" // the claim matches the overall population, not a subgroup
  | "no_subgroup_match" // the claim's magnitude matches no supplied subgroup
  | "insufficient_subgroups"; // fewer than two poolable subgroups to contrast

export interface SubgroupPrimacyCheck {
  verdict: SubgroupPrimacyVerdict;
  rationale: string;
  matchedSubgroup: string | null;
  matchedSubgroupReductionPercent: number | null;
  overallReductionPercent: number | null;
  // Why the matched subgroup fails the primacy bar (empty when it does not fail).
  primacyFailures: ("post_hoc" | "interaction_not_significant")[];
  prespecified: boolean | null;
  interactionPValue: number | null;
  // The underlying deterministic subgroup check, for the citation trail.
  subgroupCheck: SubgroupCheck;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Flag a claim that quotes a SUBGROUP effect but states it as the PRIMARY /
 * whole-population result, when the subgroup is not credible enough to be primary
 * (post-hoc, or the interaction test is not significant).
 *
 * Deterministic and additive on top of `verifyAgainstSubgroups`: it reuses that
 * engine's pooled subgroup effects and interaction test, then decides primacy
 * purely by rule from the caller-declared provenance (`prespecified`,
 * `interactionPValue`). Fires `subgroup_cited_as_primary` ONLY when the claim's
 * magnitude matches a subgroup, does NOT match the overall population, and the
 * matched subgroup fails the primacy bar. Otherwise it defers honestly
 * (credible subgroup / reflects overall / no match / insufficient data) rather
 * than over-flagging. No LLM in the loop; pure — does not mutate its inputs.
 */
export function checkSubgroupCitedAsPrimary(
  claim: string,
  subgroups: readonly Subgroup[],
  provenance: readonly SubgroupProvenance[]
): SubgroupPrimacyCheck {
  const subgroupCheck = verifyAgainstSubgroups(claim, subgroups);
  const overallReductionPercent = subgroupCheck.overallReductionPercent;

  if (subgroupCheck.verdict === "insufficient_subgroups") {
    return {
      verdict: "insufficient_subgroups",
      rationale: subgroupCheck.rationale,
      matchedSubgroup: null,
      matchedSubgroupReductionPercent: null,
      overallReductionPercent,
      primacyFailures: [],
      prespecified: null,
      interactionPValue: null,
      subgroupCheck,
    };
  }

  // Which subgroup (if any) the claim's magnitude matched, per the engine.
  const matchedName = subgroupCheck.matchedSubgroup;
  if (matchedName === null) {
    return {
      verdict: "no_subgroup_match",
      rationale: `The claim's magnitude does not match any single supplied subgroup, so there is no subgroup being cited as the primary result. ${subgroupCheck.rationale}`,
      matchedSubgroup: null,
      matchedSubgroupReductionPercent: null,
      overallReductionPercent,
      primacyFailures: [],
      prespecified: null,
      interactionPValue: null,
      subgroupCheck,
    };
  }

  // The claim matches the OVERALL effect (engine says the claim reflects the
  // whole population): no subgroup is being passed off as primary.
  if (subgroupCheck.verdict === "overall_effect_holds") {
    return {
      verdict: "reflects_overall_effect",
      rationale: `The claim's magnitude is consistent with the OVERALL pooled effect, not a single subgroup — it is not a subgroup finding cited as the primary result. ${subgroupCheck.rationale}`,
      matchedSubgroup: matchedName,
      matchedSubgroupReductionPercent: subgroupCheck.matchedSubgroupReductionPercent,
      overallReductionPercent,
      primacyFailures: [],
      prespecified: null,
      interactionPValue: null,
      subgroupCheck,
    };
  }

  // The claim rests on the matched subgroup and NOT the overall population
  // (engine verdict `subgroup_only_effect`). Now decide primacy from provenance.
  const prov = provenance.find((p) => p.name === matchedName) ?? null;
  const prespecified = prov ? prov.prespecified : false;
  const declaredInteractionP =
    prov && typeof prov.interactionPValue === "number" ? prov.interactionPValue : null;
  // Prefer the caller-declared interaction p; otherwise fall back to the engine's
  // computed between-groups p-value for that split.
  const interactionPValue =
    declaredInteractionP ?? subgroupCheck.result?.pValue ?? null;

  const failures: ("post_hoc" | "interaction_not_significant")[] = [];
  if (!prespecified) failures.push("post_hoc");
  if (interactionPValue !== null && interactionPValue >= INTERACTION_ALPHA) {
    failures.push("interaction_not_significant");
  }

  const matchedRed = subgroupCheck.matchedSubgroupReductionPercent;
  const overallText =
    overallReductionPercent !== null ? `~${round1(overallReductionPercent)}%` : "a weaker/absent";
  const matchedText = matchedRed !== null ? `~${round1(matchedRed)}%` : "its";

  if (failures.length > 0) {
    const reasons: string[] = [];
    if (failures.includes("post_hoc")) {
      reasons.push(
        `the "${matchedName}" subgroup was POST-HOC (not pre-specified in the protocol/SAP), so its effect is hypothesis-generating, not confirmatory`
      );
    }
    if (failures.includes("interaction_not_significant")) {
      reasons.push(
        `the test for subgroup differences is not significant (interaction p=${
          interactionPValue !== null ? round1(interactionPValue * 1000) / 1000 : "n/a"
        } ≥ ${INTERACTION_ALPHA}), so the split is not statistically supported`
      );
    }
    return {
      verdict: "subgroup_cited_as_primary",
      rationale: `The claim's ${matchedText} reduction matches the "${matchedName}" subgroup, but NOT the overall population (${overallText} reduction), and ${reasons.join(
        " and "
      )}. Presenting this subgroup effect as the trial's primary/whole-population result overstates what the trial confirmed.`,
      matchedSubgroup: matchedName,
      matchedSubgroupReductionPercent: matchedRed,
      overallReductionPercent,
      primacyFailures: failures,
      prespecified,
      interactionPValue,
      subgroupCheck,
    };
  }

  // The matched subgroup is pre-specified AND interaction-supported: a credible
  // subgroup effect. We still note it is a subgroup — not the overall — finding.
  return {
    verdict: "subgroup_effect_credible",
    rationale: `The claim's ${matchedText} reduction matches the pre-specified "${matchedName}" subgroup, and the test for subgroup differences is significant (interaction p=${
      interactionPValue !== null ? round1(interactionPValue * 1000) / 1000 : "n/a"
    } < ${INTERACTION_ALPHA}). This is a credible effect-modification finding, though it is a subgroup — not the overall population (${overallText} reduction) — result.`,
    matchedSubgroup: matchedName,
    matchedSubgroupReductionPercent: matchedRed,
    overallReductionPercent,
    primacyFailures: [],
    prespecified,
    interactionPValue,
    subgroupCheck,
  };
}
