// Deterministic effect-size reconciliation. This is the numeric "catch" layer that
// a generic LLM wrapper does not reproduce: it parses reported effect sizes out of
// source text and claim text with plain regex, then applies ONLY rule-decidable
// comparisons. It NEVER guesses. When a case is not decidable by rule — numbers
// absent, measures incomparable, or relative-vs-absolute framing — it defers with
// "cannot_reconcile" rather than adjudicating. Every verdict is defensible by the
// exact numbers it parsed, which appear in the returned rationale.

export type EffectMeasure = "RR" | "HR" | "OR" | "RRR" | "absolute" | "unknown";

export interface ParsedEffect {
  measure: EffectMeasure;
  point: number | null; // e.g. 0.75 for HR 0.75; 27 for a 27% RRR; 0.45 for "0.45 points"
  ciLow: number | null;
  ciHigh: number | null;
  isPercent: boolean;
  raw: string; // the exact matched substring
}

export type ReconcileVerdict =
  | "magnitude_overstated"
  | "caveat_dropped"
  | "consistent"
  | "cannot_reconcile";

export interface Reconciliation {
  verdict: ReconcileVerdict;
  rationale: string;
  sourceEffect: ParsedEffect | null;
  claimedValue: number | null;
}

// Ratio measures share a null of 1 and a common numeric grammar (point + CI).
const RATIO_MEASURES: ReadonlySet<EffectMeasure> = new Set(["RR", "HR", "OR"]);

// Materiality: a claimed relative reduction must exceed the source's by this factor
// before we call it overstated. Keeps us off borderline rounding disputes.
const OVERSTATE_FACTOR = 1.5;

// Optional CI clause: "(95% CI, 0.64 to 0.89)", "95% CI 0.64-0.89", "(1.2-2.7)".
const CI_CLAUSE =
  "(?:[\\s,;(]*(?:95\\s*%\\s*)?(?:CI|confidence interval)?[\\s,:]*)" +
  "(\\d+(?:\\.\\d+)?)\\s*(?:to|[-‐‑‒–—−])\\s*(\\d+(?:\\.\\d+)?)";

const NUM = "(\\d+(?:\\.\\d+)?)";

// The ratio point estimate must NOT be a percentage — "relative risk reduction of 27%"
// is an RRR, not a ratio. The lookahead forbids a following digit or % so the number
// can't be truncated ("2" of "27%") or be a percent value.
const RATIO_POINT = NUM + "(?![\\d%])(?!\\s*%)";
const CI_OPTIONAL = "(?:\\s*\\(?\\s*" + CI_CLAUSE + "\\s*\\)?)?";

// Spelled-out labels are unambiguous, so we tolerate connector words between the label
// and the number (e.g. "hazard ratio with intensive treatment, 0.75", "hazard ratio of 0.75")
// — bounded, and never crossing a period/newline.
const RATIO_RE_SPELLED = new RegExp(
  "(hazard ratio|risk ratio|relative risk|odds ratio)[^\\d.\\n]{0,40}?" + RATIO_POINT + CI_OPTIONAL,
  "gi"
);

// The 2-letter abbreviations are ambiguous (RR/OR appear in prose), so keep them tight:
// a word boundary, then only whitespace/punctuation before the number.
const RATIO_RE_ABBR = new RegExp(
  "\\b(HR|RR|OR)[\\s,:=]*" + RATIO_POINT + CI_OPTIONAL,
  "gi"
);

const RATIO_REGEXES = [RATIO_RE_SPELLED, RATIO_RE_ABBR];

// A relative risk reduction stated as a percentage, in either common phrasing.
const RRR_RE = new RegExp(
  "(?:relative risk reduction of|(?:relative risk reduction|RRR)[\\s,:=]*|" +
    "(?:reduc\\w*|lower\\w*|cut\\w*|decreas\\w*)[^.%]*?by(?:\\s+about|\\s+roughly)?\\s+)" +
    "\\s*" +
    NUM +
    "\\s*%",
  "gi"
);

// An absolute effect expressed in points, e.g. "0.45 points".
const POINTS_RE = new RegExp(NUM + "\\s*points?\\b", "gi");

function labelToMeasure(label: string): EffectMeasure {
  const l = label.toLowerCase();
  if (l.startsWith("hazard") || l === "hr") return "HR";
  if (l.startsWith("odds") || l === "or") return "OR";
  if (l.startsWith("risk ratio") || l.startsWith("relative risk") || l === "rr") return "RR";
  return "unknown";
}

function toCi(low: string | undefined, high: string | undefined): {
  ciLow: number | null;
  ciHigh: number | null;
} {
  if (low === undefined || high === undefined) return { ciLow: null, ciHigh: null };
  return { ciLow: Number(low), ciHigh: Number(high) };
}

/**
 * Extract every effect size we can recognize from `text`. Pure: returns a fresh
 * array and never mutates its input. Percent reductions keep isPercent=true and a
 * whole-number point (e.g. 27). Ratio measures carry any parsed CI bounds.
 */
export function parseEffectSizes(text: string): ParsedEffect[] {
  const effects: ParsedEffect[] = [];

  for (const re of RATIO_REGEXES) {
    for (const m of text.matchAll(re)) {
      const { ciLow, ciHigh } = toCi(m[3], m[4]);
      effects.push({
        measure: labelToMeasure(m[1]),
        point: Number(m[2]),
        ciLow,
        ciHigh,
        isPercent: false,
        raw: m[0].trim(),
      });
    }
  }

  for (const m of text.matchAll(RRR_RE)) {
    effects.push({
      measure: "RRR",
      point: Number(m[1]),
      ciLow: null,
      ciHigh: null,
      isPercent: true,
      raw: m[0].trim(),
    });
  }

  for (const m of text.matchAll(POINTS_RE)) {
    effects.push({
      measure: "absolute",
      point: Number(m[1]),
      ciLow: null,
      ciHigh: null,
      isPercent: false,
      raw: m[0].trim(),
    });
  }

  return effects;
}

// A definite benefit assertion in the claim, e.g. "significantly reduced".
const BENEFIT_RE =
  /\b(reduc\w*|lower\w*|cut\w*|decreas\w*|improv\w*|effective|benefit\w*|prevent\w*|halv\w*|cuts?\b)/i;

// "cuts risk in half" / "halved risk" => an implied 50% relative reduction.
const HALF_RE = /\b(in half|by half|halv\w*)\b/i;

/** The relative reduction (as a percent) implied by a ratio point estimate, e.g. RR 0.8 -> 20. */
function ratioToReductionPercent(point: number): number {
  return (1 - point) * 100;
}

/** Pick the most reconcilable source effect: prefer ratio measures, then RRR, then absolute. */
function primarySourceEffect(effects: readonly ParsedEffect[]): ParsedEffect | null {
  return (
    effects.find((e) => RATIO_MEASURES.has(e.measure)) ??
    effects.find((e) => e.measure === "RRR") ??
    effects.find((e) => e.measure === "absolute") ??
    null
  );
}

/** True when a ratio effect's 95% CI spans the null value of 1 (not significant). */
function ratioCiCrossesNull(e: ParsedEffect): boolean {
  if (e.ciLow === null || e.ciHigh === null) return false;
  return e.ciLow <= 1 && e.ciHigh >= 1;
}

/** The claimed relative reduction (percent), inferred from the claim text, or null. */
export function claimedReductionPercent(claim: string): number | null {
  if (HALF_RE.test(claim)) return 50;
  const parsed = parseEffectSizes(claim);
  const rrr = parsed.find((e) => e.measure === "RRR");
  if (rrr && rrr.point !== null) return rrr.point;
  const ratio = parsed.find((e) => RATIO_MEASURES.has(e.measure));
  if (ratio && ratio.point !== null) return ratioToReductionPercent(ratio.point);
  return null;
}

function overstated(
  source: ParsedEffect,
  sourceReduction: number,
  claimedReduction: number,
  claim: string
): Reconciliation {
  return {
    verdict: "magnitude_overstated",
    rationale:
      `Claim implies a ~${round(claimedReduction)}% reduction, but the source reports ` +
      `${describeReduction(source, sourceReduction)} — the claim overstates the effect.`,
    sourceEffect: source,
    claimedValue: claimedReduction,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function describeReduction(source: ParsedEffect, reduction: number): string {
  if (source.measure === "RRR") return `a ${round(source.point ?? reduction)}% relative risk reduction`;
  return `${source.measure} ${source.point} (~${round(reduction)}% reduction)`;
}

/**
 * Deterministically reconcile a claim against source text. Fires ONLY on two
 * rule-decidable cases — magnitude overstated, or a dropped null-crossing caveat —
 * and otherwise returns "consistent" (numbers agree) or "cannot_reconcile" (numbers
 * absent or incomparable, including relative-% claim vs absolute-points source).
 * Pure: does not mutate its inputs.
 */
export function reconcile(claim: string, sourceText: string): Reconciliation {
  const sourceEffects = parseEffectSizes(sourceText);
  const source = primarySourceEffect(sourceEffects);

  if (source === null || source.point === null) {
    return {
      verdict: "cannot_reconcile",
      rationale: "No parseable effect size found in the source; deferring rather than guessing.",
      sourceEffect: null,
      claimedValue: null,
    };
  }

  const assertsBenefit = BENEFIT_RE.test(claim);

  // (2) CAVEAT DROPPED: source CI crosses the null (not significant) yet the claim
  // asserts a definite benefit. Checked first — a non-significant result should not
  // be reframed as a strong effect regardless of magnitude.
  if (assertsBenefit && RATIO_MEASURES.has(source.measure) && ratioCiCrossesNull(source)) {
    return {
      verdict: "caveat_dropped",
      rationale:
        `Source ${source.measure} ${source.point} has a 95% CI of ${source.ciLow} to ${source.ciHigh}, ` +
        `which crosses the null of 1 (not statistically significant), but the claim asserts a definite benefit.`,
      sourceEffect: source,
      claimedValue: null,
    };
  }

  const claimedReduction = claimedReductionPercent(claim);

  // Relative-% / ratio claim vs an absolute-points-only source: incomparable framing.
  // We refuse to adjudicate relative-vs-absolute — defer.
  if (source.measure === "absolute") {
    if (claimedReduction !== null) {
      return {
        verdict: "cannot_reconcile",
        rationale:
          `Claim is a relative ~${round(claimedReduction)}% reduction but the source reports only an ` +
          `absolute change (${source.raw}); relative-vs-absolute framing is not safely comparable.`,
        sourceEffect: source,
        claimedValue: claimedReduction,
      };
    }
    return {
      verdict: "cannot_reconcile",
      rationale: `Source reports an absolute change (${source.raw}) with no comparable numeric claim to reconcile.`,
      sourceEffect: source,
      claimedValue: null,
    };
  }

  // Beyond this point the source is a ratio or RRR — a relative-reduction measure.
  if (claimedReduction === null) {
    return {
      verdict: "cannot_reconcile",
      rationale: `Source reports ${source.measure} ${source.point}, but the claim states no comparable numeric effect.`,
      sourceEffect: source,
      claimedValue: null,
    };
  }

  const sourceReduction =
    source.measure === "RRR" ? source.point : ratioToReductionPercent(source.point);

  // (1) MAGNITUDE OVERSTATED: claimed relative reduction materially exceeds the
  // source's, either by clearing the materiality factor or by falling outside a
  // significant CI on the ratio measure.
  const factorExceeded =
    sourceReduction > 0 && claimedReduction > sourceReduction * OVERSTATE_FACTOR;
  const ciExcluded =
    RATIO_MEASURES.has(source.measure) &&
    source.ciLow !== null &&
    !ratioCiCrossesNull(source) &&
    // claimed ratio point below the CI lower bound = stronger effect than CI allows
    (() => {
      const claimedRatioPoint = 1 - claimedReduction / 100;
      return claimedRatioPoint < (source.ciLow as number);
    })();

  if (factorExceeded || ciExcluded) {
    return overstated(source, sourceReduction, claimedReduction, claim);
  }

  return {
    verdict: "consistent",
    rationale:
      `Claim implies a ~${round(claimedReduction)}% reduction, consistent with the source's ` +
      `${describeReduction(source, sourceReduction)}.`,
    sourceEffect: source,
    claimedValue: claimedReduction,
  };
}
