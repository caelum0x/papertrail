// Deterministic biostatistics recomputed from a trial's raw 2x2 event counts.
// This lets PaperTrail verify a claim's significance/magnitude from the sponsor's
// OWN registered numbers — and cross-check the registry's reported CI — rather than
// trusting a stated effect. The log-RR delta method is hand-rolled (no maintained JS
// epidemiology library provides 2x2 CIs), but the normal quantile comes from the
// maintained `simple-statistics` package rather than a magic 1.96 constant.

import { probit } from "simple-statistics";

// z for a two-sided 95% CI = Phi^-1(0.975) ≈ 1.95996 (from simple-statistics).
const Z_95 = probit(0.975);

export interface RiskRatioEstimate {
  riskRatio: number; // treatment risk / comparator risk (<1 = reduction)
  ciLower: number; // 95% CI, log-normal method
  ciUpper: number;
  reductionPercent: number; // (1 - RR) * 100
  significant: boolean; // 95% CI excludes the null value of 1
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Risk ratio + 95% CI from a 2x2 table via the standard log-RR delta method:
 * SE(ln RR) = sqrt(1/a - 1/n1 + 1/c - 1/n2). Applies a 0.5 continuity correction
 * when any event cell is zero. Returns null when inputs are unusable.
 *
 * Arm 1 is the numerator (typically the treatment arm); pass the lower-risk arm
 * first to get a protective RR < 1. Significance is order-invariant.
 */
export function riskRatioFromCounts(
  events1: number,
  total1: number,
  events2: number,
  total2: number
): RiskRatioEstimate | null {
  if (![events1, total1, events2, total2].every((x) => Number.isFinite(x))) return null;
  if (total1 <= 0 || total2 <= 0) return null;
  if (events1 < 0 || events2 < 0 || events1 > total1 || events2 > total2) return null;

  // Haldane–Anscombe continuity correction when an event cell is zero.
  const zeroCell = events1 === 0 || events2 === 0;
  const a = events1 + (zeroCell ? 0.5 : 0);
  const n1 = total1 + (zeroCell ? 1 : 0);
  const c = events2 + (zeroCell ? 0.5 : 0);
  const n2 = total2 + (zeroCell ? 1 : 0);

  const p1 = a / n1;
  const p2 = c / n2;
  if (p1 <= 0 || p2 <= 0) return null;

  const rr = p1 / p2;
  const lnRr = Math.log(rr);
  const se = Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n2);
  const ciLower = Math.exp(lnRr - Z_95 * se);
  const ciUpper = Math.exp(lnRr + Z_95 * se);

  return {
    riskRatio: round(rr, 3),
    ciLower: round(ciLower, 2),
    ciUpper: round(ciUpper, 2),
    reductionPercent: round((1 - rr) * 100, 1),
    significant: ciUpper < 1 || ciLower > 1,
  };
}
