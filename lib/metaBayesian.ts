// Deterministic Bayesian random-effects meta-analysis by a closed-form normal
// approximation (conjugate normal-normal model). No MCMC, no sampling, no LLM —
// every number is reproducible from the inputs, exactly like the frequentist
// engine in lib/metaAnalysis.ts.
//
// -------------------------------------------------------------------------
// The model (and the approximation we make explicit)
// -------------------------------------------------------------------------
//
// Standard random-effects meta-analysis on the log scale:
//
//   y_i | theta_i ~ Normal(theta_i, v_i)          (within-study sampling)
//   theta_i | mu, tau^2 ~ Normal(mu, tau^2)        (between-study heterogeneity)
//
// A FULL Bayesian treatment places a prior on (mu, tau^2) and integrates tau^2
// out with MCMC. We deliberately do NOT do that (the moat rule forbids any
// stochastic/opaque step in the numeric path, and MCMC is neither deterministic
// nor reproducible bit-for-bit). Instead we use the standard, well-documented
// EMPIRICAL-BAYES / normal-approximation shortcut:
//
//   1. tau^2 is FIXED at a point estimate (DerSimonian–Laird by default, the
//      same estimator lib/metaAnalysis.ts already computes). This is the
//      "plug-in" or "conditional" Bayesian posterior given tau^2-hat — it
//      ignores uncertainty in tau^2 itself. Documented as APPROXIMATION #1.
//
//   2. With tau^2 fixed and a FLAT (improper uniform) prior on mu, the marginal
//      likelihood for mu is exactly Normal, so the posterior for mu is:
//
//        w_i          = 1 / (v_i + tau^2)
//        mu_hat       = Σ w_i y_i / Σ w_i          (posterior mean)
//        Var(mu)      = 1 / Σ w_i                  (posterior variance)
//        mu | data    ~ Normal(mu_hat, Var(mu))
//
//      This is algebraically identical to the frequentist random-effects
//      pooled estimate — under a flat prior the Bayesian posterior mean equals
//      the inverse-variance weighted mean. An optional PROPER Normal prior
//      Normal(m0, s0^2) on mu conjugately updates to a Normal posterior
//      (precision-weighted), also in closed form.
//
//   3. The k% CREDIBLE interval is mu_hat ± z_{k} * sqrt(Var(mu)) (normal
//      posterior). Under a flat prior this coincides numerically with the
//      frequentist CI but is INTERPRETED as a probability statement about mu.
//
//   4. The POSTERIOR-PREDICTIVE interval for the true effect theta_new of a NEW
//      study (not yet observed) adds the between-study variance to the posterior
//      variance of mu:
//
//        Var(theta_new) = Var(mu) + tau^2
//        theta_new | data ~ Normal(mu_hat, Var(mu) + tau^2)
//        predictive k% interval = mu_hat ± z_{k} * sqrt(Var(mu) + tau^2)
//
//      We use a NORMAL quantile z (APPROXIMATION #2) rather than the Student-t
//      the frequentist prediction interval uses, because under the conditional
//      (tau^2-fixed) Bayesian model the predictive distribution of theta_new is
//      exactly Normal. This is the posterior-predictive analogue and is
//      documented as such; it is intentionally distinct from
//      lib/metaAnalysis.ts's t-based frequentist prediction interval.
//
// Everything is pure: no mutation of inputs, no randomness, no network, no LLM.
// The engine reuses lib/metaAnalysis.ts for study standardization + tau^2 so the
// Bayesian and frequentist views pool the IDENTICAL yi/vi numbers.

import { metaAnalyze, type StudyEffectInput, type RatioMeasure } from "./metaAnalysis";
import { ciZ } from "./stats/distributions";

// A proper conjugate Normal prior on the overall (log-scale) mean mu. Omit for
// the default flat (improper uniform) prior, under which the posterior mean is
// the inverse-variance weighted mean — the frequentist random-effects estimate.
export interface NormalPrior {
  mean: number; // m0 — prior mean on the LOG scale (e.g. 0 = null effect)
  variance: number; // s0^2 — prior variance on the log scale (must be > 0)
}

export interface BayesianMetaOptions {
  // Credible/predictive interval width, e.g. 95. Default 95.
  crediblePct?: number;
  // Optional proper Normal prior on mu (log scale). Default: flat prior.
  prior?: NormalPrior;
  // Override the fixed tau^2 point estimate. Default: DerSimonian–Laird from
  // lib/metaAnalysis.ts (the value the frequentist engine already reports).
  tauSquared?: number;
}

export interface Interval {
  lower: number; // ratio scale (back-transformed via exp)
  upper: number;
  lowerLog: number; // log scale
  upperLog: number;
}

export interface BayesianMetaResult {
  measure: RatioMeasure;
  k: number; // number of pooled studies

  // Posterior for the overall mean mu (log scale + back-transformed ratio).
  posteriorMeanLog: number;
  posteriorVar: number;
  posteriorMean: number; // exp(posteriorMeanLog) — ratio scale
  credible: Interval; // credible interval for mu

  // Posterior-predictive interval for a NEW study's true effect theta_new.
  predictive: Interval;

  // Fixed between-study variance used (DL by default) + its source, so the
  // caller can audit exactly which tau^2 drove the posterior.
  tauSquared: number;
  tauSource: "dersimonian_laird" | "caller_override";

  // The prior actually applied (echoed for reproducibility/audit).
  prior: { type: "flat" } | { type: "normal"; mean: number; variance: number };

  crediblePct: number;

  // Probability the pooled effect is on the beneficial side of the null
  // (ratio < 1 <=> log effect < 0), read off the Normal posterior CDF. A
  // deterministic posterior probability, NOT a p-value.
  probBelowNull: number;

  // Studies dropped during standardization, surfaced honestly (never silently
  // ignored) — forwarded from the frequentist engine.
  skipped: { label: string; reason: string }[];
}

const DEFAULT_CREDIBLE_PCT = 95;

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Standard normal CDF Phi(x) via the erf relation, using a high-accuracy
// rational approximation of erf (Abramowitz & Stegun 7.1.26, max abs error
// ~1.5e-7). Deterministic; sufficient for a reported posterior probability.
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

function toInterval(centerLog: number, halfWidthLog: number): Interval {
  const lowerLog = centerLog - halfWidthLog;
  const upperLog = centerLog + halfWidthLog;
  return {
    lower: round(Math.exp(lowerLog), 3),
    upper: round(Math.exp(upperLog), 3),
    lowerLog,
    upperLog,
  };
}

/**
 * Deterministic Bayesian random-effects meta-analysis via the closed-form
 * normal-normal (conjugate) approximation described in this file's header.
 *
 * Reuses lib/metaAnalysis.ts to standardize the supplied ratio-measure studies
 * to the log scale (yi, vi) and to obtain the DerSimonian–Laird tau^2, so the
 * Bayesian and frequentist engines pool the identical numbers. With tau^2 held
 * fixed at that point estimate and a flat (default) or proper Normal prior on
 * mu, it returns the posterior mean, a credible interval for mu, and a
 * posterior-predictive interval for a new study's true effect — all in closed
 * form, no MCMC, no LLM.
 *
 * Returns null when fewer than two studies survive standardization (there is no
 * pool to place a posterior over) — the honest-insufficient path. Pure: does
 * not mutate its inputs.
 *
 * @param inputs  Ratio-measure studies (point+CI or 2x2 counts), same contract
 *                as lib/metaAnalysis.ts.
 * @param options Interval width, optional proper prior, optional tau^2 override.
 */
export function bayesianMetaAnalyze(
  inputs: readonly StudyEffectInput[],
  options: BayesianMetaOptions = {}
): BayesianMetaResult | null {
  const crediblePct = options.crediblePct ?? DEFAULT_CREDIBLE_PCT;
  if (!(crediblePct > 0 && crediblePct < 100)) {
    throw new Error("crediblePct must be strictly between 0 and 100.");
  }

  // Standardize + pool with the existing frequentist engine. This gives us the
  // per-study (yi, vi), the DL tau^2, and the honest `skipped` list for free.
  const freq = metaAnalyze(inputs);
  if (freq === null) return null;

  const yi = freq.studies.map((s) => s.yi);
  const vi = freq.studies.map((s) => s.vi);
  const k = yi.length;

  // Fixed between-study variance: caller override or DL (APPROXIMATION #1).
  let tauSquared: number;
  let tauSource: BayesianMetaResult["tauSource"];
  if (typeof options.tauSquared === "number") {
    if (options.tauSquared < 0 || !Number.isFinite(options.tauSquared)) {
      throw new Error("tauSquared override must be a finite, non-negative number.");
    }
    tauSquared = options.tauSquared;
    tauSource = "caller_override";
  } else {
    tauSquared = freq.heterogeneity.tauSquared;
    tauSource = "dersimonian_laird";
  }

  // Inverse-variance weights with tau^2 folded in (random-effects precision of
  // each study's contribution to the likelihood for mu).
  const weights = vi.map((v) => 1 / (v + tauSquared));
  const sumW = weights.reduce((acc, w) => acc + w, 0);
  const dataPrecision = sumW; // Σ w_i
  const dataMeanLog =
    yi.reduce((acc, y, i) => acc + weights[i] * y, 0) / sumW; // Σ w_i y_i / Σ w_i

  // Conjugate update of a Normal prior on mu (flat prior => prior precision 0,
  // recovering the pure inverse-variance weighted mean).
  let priorPrecision = 0;
  let priorPrecisionTimesMean = 0;
  let priorEcho: BayesianMetaResult["prior"] = { type: "flat" };
  if (options.prior) {
    const { mean: m0, variance: s0 } = options.prior;
    if (!(s0 > 0) || !Number.isFinite(s0) || !Number.isFinite(m0)) {
      throw new Error("Normal prior requires a finite mean and a positive, finite variance.");
    }
    priorPrecision = 1 / s0;
    priorPrecisionTimesMean = priorPrecision * m0;
    priorEcho = { type: "normal", mean: m0, variance: s0 };
  }

  const posteriorPrecision = priorPrecision + dataPrecision;
  const posteriorVar = 1 / posteriorPrecision;
  const posteriorMeanLog =
    (priorPrecisionTimesMean + dataPrecision * dataMeanLog) / posteriorPrecision;

  const z = ciZ(crediblePct);

  // Credible interval for mu: Normal(posteriorMeanLog, posteriorVar).
  const credibleHalfWidth = z * Math.sqrt(posteriorVar);
  const credible = toInterval(posteriorMeanLog, credibleHalfWidth);

  // Posterior-predictive interval for a NEW study's true effect theta_new:
  // Var = posteriorVar + tau^2 (APPROXIMATION #2 — Normal quantile).
  const predictiveVar = posteriorVar + tauSquared;
  const predictiveHalfWidth = z * Math.sqrt(predictiveVar);
  const predictive = toInterval(posteriorMeanLog, predictiveHalfWidth);

  // Posterior probability the effect is below the null (ratio < 1 <=> log < 0):
  // Phi( (0 - posteriorMeanLog) / sqrt(posteriorVar) ).
  const probBelowNull = normalCdf((0 - posteriorMeanLog) / Math.sqrt(posteriorVar));

  return {
    measure: freq.measure,
    k,
    posteriorMeanLog,
    posteriorVar,
    posteriorMean: round(Math.exp(posteriorMeanLog), 3),
    credible,
    predictive,
    tauSquared: round(tauSquared, 6),
    tauSource,
    prior: priorEcho,
    crediblePct,
    probBelowNull: round(probBelowNull, 4),
    skipped: freq.skipped,
  };
}
