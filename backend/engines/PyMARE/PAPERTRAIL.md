# PaperTrail specialization of PyMARE

`pymare/papertrail_bayesian.py` in this engine is a **PaperTrail-native specialization**
of PyMARE (github.com/neurostuff/PyMARE, MIT). This repo owns the vendored PyMARE tree;
rather than fork or fight the upstream estimator classes, we added **one file** that
re-implements the *deterministic closed forms* PaperTrail's TypeScript engine already
computes, so an independent implementation can confirm the exact numbers the app serves.

**No other file in this engine is modified.** `papertrail_bayesian.py` is standalone,
stdlib-only Python (no PyMARE install, no numpy/scipy, no network, no model download), and
this whole directory is excluded from the Next build — so there is **zero TypeScript/build
impact**.

---

## Why it exists

PaperTrail's Later-tier meta layer adds two deterministic capabilities to the frequentist
random-effects engine (`lib/metaAnalysis.ts`):

| TypeScript engine | What it computes |
| --- | --- |
| `lib/metaBayesian.ts` | Closed-form conjugate normal-normal **Bayesian** random-effects meta: posterior mean + credible interval for the overall effect, and a **posterior-predictive** interval for a new study's true effect. |
| `lib/metaSensitivity.ts` | **Leave-one-out** sensitivity: re-pool dropping each study, report the swing + influence/significance-flip flags. |

Both are served by `app/api/meta/bayesian` and `app/api/meta/sensitivity`. The **moat rule**
is: *no LLM, no MCMC, no randomness in the numeric path — deterministic math decides.* So the
"Bayesian" posterior is **not** MCMC; it is the standard normal-approximation with `tau^2`
fixed at the DerSimonian–Laird point estimate (documented as an approximation in both the TS
and Python files). This file is the **independent second implementation** of that same math —
PyMARE's role across the codebase (see `lib/engines/metaCrossCheck.ts`) is exactly this:
a battle-tested reference against which a divergence flags a real bug in one side.

It maps onto PyMARE's own architecture, specialized to the intercept-only (single overall
mean) model where the design matrix `X` reduces to a column of ones:

| PyMARE construct | `papertrail_bayesian.py` |
| --- | --- |
| `DerSimonianLaird` estimator (`estimators/estimators.py`) | `_dersimonian_laird_tau2()` — the same method-of-moments `tau^2` |
| `weighted_least_squares` (`stats.py`), intercept-only | `_weighted_mean()` / `_random_effects_pool()` — inverse-variance weighted mean + `Var = 1/Σw` |
| `BayesianMetaRegressionResults` (`results.py`) | `_bayesian()` — closed-form posterior + posterior-predictive under fixed `tau^2` |
| `MetaRegressionResults` leave-one influence | `_sensitivity()` — leave-one-out re-pool + swing/flip flags |

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network, no MCMC, no randomness. Same input →
  same output, always. `math.erf` / Acklam's quantile give closed-form Normal CDF/quantile
  (the Acklam coefficients are byte-identical to `lib/stats/distributions.ts`, so `ciZ`
  agrees to ~1e-9).
- **Same inputs as the TS engine** — it consumes the **already-standardized** log effects
  `yi` and their sampling variances `vi` (the exact numbers `lib/metaAnalysis.ts`
  `toLogEffect` produced), so any divergence in the posterior/predictive/leave-one-out
  numbers is a real formula bug, not a difference of inputs. Standardization from raw
  RR/HR/OR + CI stays owned by the TS side — this file never re-derives it.
- **Honest insufficient** — fewer than two usable studies → `bayesian: null` (no pool to
  place a posterior over); fewer than three → `sensitivity: null` (each leave-one-out pool
  needs two remaining). Never forces an answer. Mirrors `MIN_POOL`/`MIN_LOO` and the
  `null`-return contract of both TS engines.
- **No claim/source text** — it only ever sees numeric `yi`/`vi`; there is nothing textual
  to leak, and it prints only numbers + a boolean/`error` envelope.
- **Honest boundary failure** — invalid JSON or an out-of-contract payload is reported as
  `{"ok": false, "error": ...}` on stdout with exit code `2`, never a silent crash and
  never echoing input values.

---

## The closed forms (and the two documented approximations)

On the log scale, with `w_i = 1/(v_i + tau^2)`:

```
tau^2            = DerSimonian–Laird point estimate         (APPROXIMATION #1: fixed, not integrated)
posteriorVar     = 1 / Σ w_i                                (flat prior; proper Normal prior updates by precision)
posteriorMeanLog = Σ w_i y_i / Σ w_i                        (= inverse-variance weighted mean under a flat prior)
credible k%      = posteriorMeanLog ± z_k · sqrt(posteriorVar)
predictive k%    = posteriorMeanLog ± z_k · sqrt(posteriorVar + tau^2)   (APPROXIMATION #2: Normal quantile, not t)
probBelowNull    = Phi( (0 − posteriorMeanLog) / sqrt(posteriorVar) )
```

- **Approximation #1** — `tau^2` is held fixed at its DL point estimate (the "conditional" /
  empirical-Bayes posterior), rather than integrated out with MCMC. This is what makes the
  posterior deterministic and reproducible.
- **Approximation #2** — the posterior-predictive interval uses a **Normal** quantile `z`,
  because under the fixed-`tau^2` conditional model the predictive distribution of a new
  study's true effect is exactly Normal. This is deliberately distinct from the **Student-t**
  frequentist *prediction* interval in `lib/metaAnalysis.ts`; the two answer different
  questions (Bayesian posterior-predictive vs. frequentist prediction).

Under a **flat prior** the posterior mean coincides numerically with the frequentist
random-effects pooled estimate — but it is *interpreted* as a probability statement about the
overall effect. A **proper Normal prior** `Normal(m0, s0^2)` on the log-scale mean updates
conjugately (precision-weighted) to a Normal posterior, also in closed form.

---

## How to invoke

Standalone, stdlib only (no install):

```bash
# JSON on stdin: standardized log effects + variances (+ optional knobs).
echo '{"yi":[-0.223,-0.357,-0.105],"vi":[0.02,0.03,0.05]}' \
  | python3 papertrail_bayesian.py

# Via a --json flag, with a proper Normal prior on the log-scale mean and a
# 90% credible interval.
python3 papertrail_bayesian.py --json \
  '{"yi":[-0.223,-0.357,-0.105],"vi":[0.02,0.03,0.05],
    "crediblePct":90,"prior":{"mean":0,"variance":4}}'

# Override the fixed tau^2 (e.g. to check a Paule–Mandel value from
# lib/metaEstimators.ts) instead of the built-in DerSimonian–Laird.
python3 papertrail_bayesian.py --json \
  '{"yi":[...],"vi":[...],"tauSquared":0.012}'
```

### Input contract

| field | type | meaning |
| --- | --- | --- |
| `yi` | `number[]` | log effects (standardized by the TS engine); finite |
| `vi` | `number[]` | sampling variances of `yi`; strictly positive, same length as `yi` |
| `crediblePct` | `number?` | credible/predictive interval width, default `95` (0 < pct < 100) |
| `prior` | `{mean, variance}?` | proper Normal prior on the log-scale mean; omit for a flat prior |
| `tauSquared` | `number?` | fixed `tau^2` override; omit to use DerSimonian–Laird |

### Output shape

```json
{
  "ok": true,
  "bayesian": {
    "k": 3,
    "tauSquared": 0.0012, "tauSource": "dersimonian_laird",
    "prior": {"type": "flat"}, "crediblePct": 95,
    "posteriorMeanLog": -0.213, "posteriorVar": 0.0091,
    "posteriorMean": 0.808,
    "credible":   {"lowerLog": -0.400, "upperLog": -0.026, "lower": 0.670, "upper": 0.974},
    "predictive": {"lowerLog": -0.478, "upperLog":  0.052, "lower": 0.620, "upper": 1.053},
    "probBelowNull": 0.9873
  },
  "sensitivity": {
    "k": 3, "overallLogPoint": -0.213, "overallSignificant": true, "iSquared": 0.0,
    "leaveOneOut": [
      {"index": 0, "k": 2, "logPoint": -0.19, "logShift": 0.023,
       "point": 0.827, "significant": true, "flipsSignificance": false, "influential": false}
    ],
    "maxLogSwing": 0.087, "influentialIndices": [], "anyFlipsSignificance": false
  }
}
```

`bayesian` is `null` for fewer than two usable studies; `sensitivity` is `null` for fewer
than three. The log-scale fields (`posteriorMeanLog`, `*.lowerLog`/`*.upperLog`,
`overallLogPoint`, `logShift`, `maxLogSwing`) are the ones to diff against the TS engine —
they are computed identically on both sides and should agree to floating-point noise across
the Python↔JSON round-trip.

### Mapping to the TypeScript contracts

| `papertrail_bayesian.py` field | TS source |
| --- | --- |
| `bayesian.posteriorMeanLog` / `posteriorVar` | `BayesianMetaResult.posteriorMeanLog` / `posteriorVar` (`lib/metaBayesian.ts`) |
| `bayesian.credible.{lowerLog,upperLog}` | `BayesianMetaResult.credible.{lowerLog,upperLog}` |
| `bayesian.predictive.{lowerLog,upperLog}` | `BayesianMetaResult.predictive.{lowerLog,upperLog}` |
| `bayesian.probBelowNull` | `BayesianMetaResult.probBelowNull` |
| `sensitivity.leaveOneOut[].logShift` | `SensitivityResult.leaveOneOut[].logShift` (`lib/metaSensitivity.ts`) |
| `sensitivity.maxLogSwing` | `SensitivityResult.maxLogSwing` |
| `sensitivity.anyFlipsSignificance` | `SensitivityResult.anyFlipsSignificance` |

The `INFLUENCE_LOG_SHIFT_THRESHOLD = 0.1`, `MIN_POOL = 2`, and `MIN_LOO = 3` constants are
byte-for-byte the same as their TypeScript counterparts, so the influence flags agree.
```
