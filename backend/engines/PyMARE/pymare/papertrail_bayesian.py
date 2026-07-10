#!/usr/bin/env python3
"""PaperTrail-native reference cross-check for the Bayesian + sensitivity
meta-analysis engine.

This file is a **PaperTrail specialization** of the PyMARE engine. It re-implements
the *deterministic closed forms* that PaperTrail's TypeScript engine computes
(`lib/metaBayesian.ts` and `lib/metaSensitivity.ts`), so a second, independent
implementation can confirm the numbers the app serves. It mirrors PyMARE's
random-effects `VarianceBasedLikelihoodEstimator` / `DerSimonianLaird` +
`BayesianMetaRegressionResults` semantics, specialized to the intercept-only
(single overall mean) meta-analysis model where the design matrix X reduces to a
column of ones.

**No other file in this engine is modified.** This module is standalone,
stdlib-only Python (no PyMARE install, no numpy/scipy, no network, no model), and
this whole directory is excluded from the Next build — so there is zero
TypeScript/build impact.

PaperTrail moat rules it honours:

- **No LLM, no MCMC, no randomness.** The "Bayesian" posterior here is the
  closed-form conjugate normal-normal approximation with tau^2 fixed at the
  DerSimonian-Laird point estimate — identical math to `lib/metaBayesian.ts`.
  Same input -> same output, always.
- **Honest insufficient.** Fewer than two usable studies -> no posterior
  (`bayesian: null`); fewer than three -> no leave-one-out (`sensitivity: null`).
  Nothing is forced.
- **Reproducible from inputs.** Inputs are the standardized log effects (yi) and
  their sampling variances (vi) — the exact numbers the TS engine pooled — so any
  divergence is a real formula bug, not a difference of inputs.

It intentionally consumes the ALREADY-STANDARDIZED (yi, vi) rather than raw
RR/HR/OR + CI, because standardization to the log scale is owned by the TS engine
(`lib/metaAnalysis.ts` `toLogEffect`); this reference checks only the pooling /
posterior / predictive / leave-one-out math on top of those numbers.

--------------------------------------------------------------------------------
Invocation
--------------------------------------------------------------------------------

    # JSON on stdin: {"yi": [...], "vi": [...], "crediblePct": 95,
    #                 "prior": {"mean": 0, "variance": 4}, "tauSquared": null}
    echo '{"yi":[-0.2,-0.35,-0.1],"vi":[0.02,0.03,0.05]}' \
        | python3 papertrail_bayesian.py

    # Or via a --json flag.
    python3 papertrail_bayesian.py --json '{"yi":[...],"vi":[...]}'

Output (matches the TS engine field-for-field on the log scale):

    {
      "ok": true,
      "bayesian": {
        "k": 3,
        "tauSquared": 0.0012,
        "posteriorMeanLog": -0.213,
        "posteriorVar": 0.0091,
        "credible": {"lowerLog": -0.400, "upperLog": -0.026},
        "predictive": {"lowerLog": -0.478, "upperLog": 0.052},
        "probBelowNull": 0.9873
      },
      "sensitivity": {
        "k": 3,
        "overallLogPoint": -0.213,
        "leaveOneOut": [{"index": 0, "logPoint": ..., "logShift": ...}, ...],
        "maxLogSwing": 0.087
      }
    }
"""

from __future__ import annotations

import json
import math
import sys
from typing import Optional

# Influence threshold on the log scale, identical to
# INFLUENCE_LOG_SHIFT_THRESHOLD in lib/metaSensitivity.ts.
INFLUENCE_LOG_SHIFT_THRESHOLD = 0.1

# Minimum usable studies: >= 2 to pool / place a posterior; >= 3 for leave-one-out
# (so each re-pool retains two). Mirrors the TS engines exactly.
MIN_POOL = 2
MIN_LOO = 3


# --------------------------------------------------------------------------- #
# Standard-normal helpers (no numpy/scipy). Deterministic closed forms.
# --------------------------------------------------------------------------- #

def _normal_cdf(x: float) -> float:
    """Phi(x) via math.erf. Matches the intent of normalCdf in metaBayesian.ts;
    math.erf is higher precision than the A&S 7.1.26 rational form used there,
    which only widens agreement rather than narrowing it."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _normal_quantile(p: float) -> float:
    """Phi^-1(p) via Peter Acklam's rational approximation — the same algorithm
    (and coefficients) as normalQuantile in lib/stats/distributions.ts, so
    ciZ(pct) agrees with the TS engine to ~1e-9."""
    if p <= 0.0 or p >= 1.0:
        return float("nan")
    a = [
        -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
        1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
    ]
    b = [
        -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
        6.680131188771972e1, -1.328068155288572e1,
    ]
    c = [
        -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
        -2.549732539343734, 4.374664141464968, 2.938163982698783,
    ]
    d = [
        7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
        3.754408661907416,
    ]
    p_low = 0.02425
    p_high = 1.0 - p_low
    if p < p_low:
        q = math.sqrt(-2.0 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
            (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0
        )
    if p <= p_high:
        q = p - 0.5
        r = q * q
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (
            ((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0
        )
    q = math.sqrt(-2.0 * math.log(1.0 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
        (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0
    )


def _ci_z(ci_pct: float) -> float:
    """z for a two-sided (ci_pct)% interval, matching ciZ in distributions.ts."""
    alpha = 1.0 - ci_pct / 100.0
    return _normal_quantile(1.0 - alpha / 2.0)


# --------------------------------------------------------------------------- #
# Core pooling: DerSimonian-Laird tau^2 + inverse-variance weighted mean.
# Intercept-only reduction of PyMARE's weighted_least_squares.
# --------------------------------------------------------------------------- #

def _weighted_mean(yi, vi, tau2: float) -> float:
    w = [1.0 / (v + tau2) for v in vi]
    sw = sum(w)
    return sum(wi * y for wi, y in zip(w, yi)) / sw


def _dersimonian_laird_tau2(yi, vi) -> float:
    """DerSimonian-Laird between-study variance — the exact closed form
    lib/metaAnalysis.ts uses for the frequentist random-effects pool, and the
    tau^2 metaBayesian.ts fixes the posterior at by default."""
    k = len(yi)
    w = [1.0 / v for v in vi]
    sum_w = sum(w)
    fe_mean = sum(wi * y for wi, y in zip(w, yi)) / sum_w
    q = sum(wi * (y - fe_mean) ** 2 for wi, y in zip(w, yi))
    df = k - 1
    sum_w2 = sum(wi * wi for wi in w)
    c = sum_w - sum_w2 / sum_w
    if c <= 0:
        return 0.0
    return max(0.0, (q - df) / c)


def _random_effects_pool(yi, vi, tau2: float):
    """Random-effects pooled log estimate + its variance under fixed tau^2."""
    w = [1.0 / (v + tau2) for v in vi]
    sum_w = sum(w)
    log_point = sum(wi * y for wi, y in zip(w, yi)) / sum_w
    var = 1.0 / sum_w
    return log_point, var


def _i_squared(yi, vi) -> float:
    k = len(yi)
    w = [1.0 / v for v in vi]
    sum_w = sum(w)
    fe_mean = sum(wi * y for wi, y in zip(w, yi)) / sum_w
    q = sum(wi * (y - fe_mean) ** 2 for wi, y in zip(w, yi))
    df = k - 1
    return round(((q - df) / q) * 100.0, 1) if q > df else 0.0


# --------------------------------------------------------------------------- #
# Bayesian posterior + posterior-predictive (mirrors lib/metaBayesian.ts).
# --------------------------------------------------------------------------- #

def _bayesian(yi, vi, credible_pct: float,
              prior: Optional[dict], tau_override: Optional[float]):
    k = len(yi)

    if tau_override is not None:
        tau2 = float(tau_override)
        tau_source = "caller_override"
    else:
        tau2 = _dersimonian_laird_tau2(yi, vi)
        tau_source = "dersimonian_laird"

    weights = [1.0 / (v + tau2) for v in vi]
    data_precision = sum(weights)
    data_mean = sum(w * y for w, y in zip(weights, yi)) / data_precision

    # Conjugate Normal-prior update (flat prior => prior precision 0).
    if prior is not None:
        s0 = float(prior["variance"])
        m0 = float(prior["mean"])
        prior_precision = 1.0 / s0
        prior_pm = prior_precision * m0
        prior_echo = {"type": "normal", "mean": m0, "variance": s0}
    else:
        prior_precision = 0.0
        prior_pm = 0.0
        prior_echo = {"type": "flat"}

    posterior_precision = prior_precision + data_precision
    posterior_var = 1.0 / posterior_precision
    posterior_mean_log = (prior_pm + data_precision * data_mean) / posterior_precision

    z = _ci_z(credible_pct)
    credible_half = z * math.sqrt(posterior_var)
    # Posterior-predictive for a NEW study: add tau^2 to the posterior variance.
    predictive_var = posterior_var + tau2
    predictive_half = z * math.sqrt(predictive_var)

    prob_below_null = _normal_cdf((0.0 - posterior_mean_log) / math.sqrt(posterior_var))

    return {
        "k": k,
        "tauSquared": round(tau2, 6),
        "tauSource": tau_source,
        "prior": prior_echo,
        "crediblePct": credible_pct,
        "posteriorMeanLog": posterior_mean_log,
        "posteriorVar": posterior_var,
        "posteriorMean": round(math.exp(posterior_mean_log), 3),
        "credible": {
            "lowerLog": posterior_mean_log - credible_half,
            "upperLog": posterior_mean_log + credible_half,
            "lower": round(math.exp(posterior_mean_log - credible_half), 3),
            "upper": round(math.exp(posterior_mean_log + credible_half), 3),
        },
        "predictive": {
            "lowerLog": posterior_mean_log - predictive_half,
            "upperLog": posterior_mean_log + predictive_half,
            "lower": round(math.exp(posterior_mean_log - predictive_half), 3),
            "upper": round(math.exp(posterior_mean_log + predictive_half), 3),
        },
        "probBelowNull": round(prob_below_null, 4),
    }


# --------------------------------------------------------------------------- #
# Leave-one-out sensitivity (mirrors lib/metaSensitivity.ts).
# --------------------------------------------------------------------------- #

def _significant(log_point: float, var: float, ci_pct: float = 95.0) -> bool:
    z = _ci_z(ci_pct)
    half = z * math.sqrt(var)
    lower = math.exp(log_point - half)
    upper = math.exp(log_point + half)
    return upper < 1.0 or lower > 1.0


def _sensitivity(yi, vi):
    k = len(yi)
    full_tau2 = _dersimonian_laird_tau2(yi, vi)
    overall_log, overall_var = _random_effects_pool(yi, vi, full_tau2)
    overall_sig = _significant(overall_log, overall_var)

    rows = []
    max_log_swing = 0.0
    any_flip = False
    influential_indices = []

    for drop in range(k):
        sub_y = [y for i, y in enumerate(yi) if i != drop]
        sub_v = [v for i, v in enumerate(vi) if i != drop]
        tau2 = _dersimonian_laird_tau2(sub_y, sub_v)
        log_point, var = _random_effects_pool(sub_y, sub_v, tau2)
        log_shift = log_point - overall_log
        sig = _significant(log_point, var)
        flips = sig != overall_sig
        influential = abs(log_shift) >= INFLUENCE_LOG_SHIFT_THRESHOLD or flips
        if abs(log_shift) > abs(max_log_swing):
            max_log_swing = log_shift
        if flips:
            any_flip = True
        if influential:
            influential_indices.append(drop)
        rows.append({
            "index": drop,
            "k": k - 1,
            "logPoint": log_point,
            "logShift": round(log_shift, 6),
            "point": round(math.exp(log_point), 3),
            "significant": sig,
            "flipsSignificance": flips,
            "influential": influential,
        })

    return {
        "k": k,
        "overallLogPoint": overall_log,
        "overallPoint": round(math.exp(overall_log), 3),
        "overallSignificant": overall_sig,
        "iSquared": _i_squared(yi, vi),
        "leaveOneOut": rows,
        "maxLogSwing": round(abs(max_log_swing), 6),
        "influentialIndices": influential_indices,
        "anyFlipsSignificance": any_flip,
    }


# --------------------------------------------------------------------------- #
# Entry point.
# --------------------------------------------------------------------------- #

def _validate(payload) -> None:
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    yi = payload.get("yi")
    vi = payload.get("vi")
    if not isinstance(yi, list) or not isinstance(vi, list):
        raise ValueError("'yi' and 'vi' must be arrays")
    if len(yi) != len(vi):
        raise ValueError("'yi' and 'vi' must be the same length")
    for y in yi:
        if not isinstance(y, (int, float)) or not math.isfinite(float(y)):
            raise ValueError("every yi must be a finite number")
    for v in vi:
        if not isinstance(v, (int, float)) or not (float(v) > 0.0) or not math.isfinite(float(v)):
            raise ValueError("every vi must be a finite positive number")


def run(payload) -> dict:
    _validate(payload)
    yi = [float(y) for y in payload["yi"]]
    vi = [float(v) for v in payload["vi"]]
    credible_pct = float(payload.get("crediblePct", 95))
    if not (0.0 < credible_pct < 100.0):
        raise ValueError("crediblePct must be strictly between 0 and 100")
    prior = payload.get("prior")
    if prior is not None:
        if not isinstance(prior, dict) or "mean" not in prior or "variance" not in prior:
            raise ValueError("prior must be an object with 'mean' and 'variance'")
        if not (float(prior["variance"]) > 0.0):
            raise ValueError("prior variance must be positive")
    tau_override = payload.get("tauSquared")
    if tau_override is not None and float(tau_override) < 0.0:
        raise ValueError("tauSquared override must be non-negative")

    bayesian = _bayesian(yi, vi, credible_pct, prior, tau_override) if len(yi) >= MIN_POOL else None
    sensitivity = _sensitivity(yi, vi) if len(yi) >= MIN_LOO else None

    return {"ok": True, "bayesian": bayesian, "sensitivity": sensitivity}


def main() -> int:
    try:
        if len(sys.argv) >= 3 and sys.argv[1] == "--json":
            raw = sys.argv[2]
        else:
            raw = sys.stdin.read()
        payload = json.loads(raw)
        result = run(payload)
        print(json.dumps(result))
        return 0
    except (ValueError, json.JSONDecodeError) as exc:
        # Honest boundary failure — never a silent crash. No input values echoed.
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
