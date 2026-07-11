# PaperTrail specialization of pytrials

Upstream [`pytrials`](https://github.com/jvfe/pytrials) (BSD-3-Clause) is a thin client
over the ClinicalTrials.gov study API — it **fetches** structured trial records but says
nothing about how far to **trust** a given trial's design when a claim leans on it.
PaperTrail is a provenance/verification tool, so it needs exactly that. This
specialization adds two deterministic layers **in place**, without modifying any
upstream file.

## What we added

`papertrail_design.py` — **eligibility gates + design-credibility priors**.

1. `parse_eligibility(text)` — split a trial's free-text eligibility blob into
   `inclusion[]` / `exclusion[]` gates using heading + bullet rules only (an
   "Inclusion Criteria:" heading with bullets, then "Exclusion Criteria:", or plain
   newline lists). Anything before the first recognized heading is treated as inclusion
   context. Pure string work — the same blob always yields the same gates.

2. `score_design_credibility(fields)` — map structured design fields to a **credibility
   tier** (`high` / `moderate` / `low` / `very_low`) and a **prior weight** in
   `[0, 1]`, plus a transparent list of the **factors** that moved the score.

### Credibility rubric (additive points, then binned to a tier)

Start from `0` points, add:

| Factor | Condition | Points |
| --- | --- | --- |
| Allocation | `randomized == true` | +2 |
| Blinding | `double`/`triple`/`quadruple` | +2 |
| Blinding | `single` | +1 |
| Blinding | `open` / `none` | +0 |
| Enrollment | `>= LARGE_ENROLLMENT` (1000) | +3 |
| Enrollment | `>= MEDIUM_ENROLLMENT` (300) | +2 |
| Enrollment | `>= SMALL_ENROLLMENT` (50) | +1 |
| Enrollment | `< 50` | +0 |
| Phase | `PHASE3` / `PHASE4` | +2 |
| Phase | `PHASE2` (incl. `PHASE1/PHASE2`, `PHASE2/PHASE3`) | +1 |
| Phase | `PHASE1` / `EARLY_PHASE1` | +0 |

Points (max **9**) are binned to a tier + prior weight:

| Points | Tier | `priorWeight` |
| --- | --- | --- |
| `>= 7` | **high** | 1.00 |
| `>= 4` | **moderate** | 0.70 |
| `>= 2` | **low** | 0.40 |
| `< 2` | **very_low** | 0.20 |

A large randomized double-blind Phase 3 trial (points 9 → high → 1.00) counts for five
times the design-prior of a tiny open-label Phase 1 study (points 0 → very_low → 0.20).

### Why this matters for PaperTrail

The prior weight is what synthesis multiplies a trial's design-derived evidence
contribution by. It is a **supporting weight on design strength — it never decides a
verdict by itself**; the verdict math lives in the deterministic verification/synthesis
path. Absent design fields deterministically **lower** the tier (report "not reported")
rather than being guessed — honest insufficient over a forced answer.

## Design constraints honored

- **Stdlib-only.** Uses only `argparse` + `json` + `re` + `dataclasses` — no third-party
  deps — so it can be shelled out to without installing the full `pytrials` package.
- **Deterministic. No LLM.** Gates, tier, weight, and factors are pure, documented
  functions of the input; the same input always yields the same output.
- **Governance-safe.** Its numeric output (tier, weight, factors, gate **counts**) is
  metadata-only and safe to log. The parsed gate strings echo the caller's own
  eligibility text and are not logged by the wiring layer.
- **Honest input handling.** On malformed input it prints `{"error": ...}` and exits
  `2`. A missing/invalid enrollment or blinding deterministically scores `0` for that
  factor rather than failing.

## CLI

Reads a JSON object on `--arg` or from stdin, prints JSON to stdout.

```bash
echo '{"design":{"randomized":true,"blinding":"double","enrollment":1200,"phase":"PHASE3"}}' \
  | python papertrail_design.py

python papertrail_design.py --arg '{"eligibility":"Inclusion Criteria:\n- Age >= 18\nExclusion Criteria:\n- Pregnancy"}'
```

```python
from papertrail_design import parse_eligibility, score_design_credibility, DesignFields

parse_eligibility("Inclusion Criteria:\n- Age >= 18\nExclusion Criteria:\n- Pregnancy")
# -> {"inclusion": ["Age >= 18"], "exclusion": ["Pregnancy"]}

score_design_credibility(DesignFields(randomized=True, blinding="double",
                                      enrollment=1200, phase="PHASE3")).to_dict()
# -> {"tier": "high", "priorWeight": 1.0, "points": 9, ...}
```

## Native TS twin + field-for-field mapping

The parser and scorer are mirrored **deterministically** in TypeScript at
[`lib/sources/trialDesign.ts`](../../../lib/sources/trialDesign.ts) and exposed as a
public compute route at `app/api/trials/design/route.ts` (POST
`{ eligibility?, design?: { randomized, blinding, enrollment, phase } }`). Every numeric
rubric constant is identical in both files.

| Python (`papertrail_design.py`) | TypeScript (`lib/sources/trialDesign.ts`) |
| --- | --- |
| `LARGE_ENROLLMENT = 1000` | `LARGE_ENROLLMENT = 1000` |
| `MEDIUM_ENROLLMENT = 300` | `MEDIUM_ENROLLMENT = 300` |
| `SMALL_ENROLLMENT = 50` | `SMALL_ENROLLMENT = 50` |
| `RANDOMIZED_POINTS = 2` | `RANDOMIZED_POINTS = 2` |
| `BLINDING_DOUBLE_POINTS = 2` / `BLINDING_SINGLE_POINTS = 1` | same |
| `ENROLLMENT_{LARGE,MEDIUM,SMALL}_POINTS = 3/2/1` | same |
| `PHASE_LATE_POINTS = 2` / `PHASE_MID_POINTS = 1` | same |
| `HIGH_CUTOFF = 7` / `MODERATE_CUTOFF = 4` / `LOW_CUTOFF = 2` | same |
| `PRIOR_WEIGHT_BY_TIER` (1.0 / 0.7 / 0.4 / 0.2) | `PRIOR_WEIGHT_BY_TIER` (same) |
| `parse_eligibility(text)` → `{"inclusion","exclusion"}` | `parseEligibility(raw)` → `EligibilityGates` |
| `score_design_credibility(DesignFields)` → `CredibilityResult` | `scoreDesignCredibility(DesignFieldsInput)` → `DesignCredibility` |
| `_normalize_blinding` (double/single/open collapse) | `normalizeBlinding` (same) |
| `_normalize_phase` (upper-case token) | `normalizePhase` (same) |
| `_phase_points` (PHASE3/4 late, PHASE2 mid) | `phasePoints` (same) |
| `_enrollment_points` (size bands) | `enrollmentPoints` (same) |
| `to_dict()["tierLabel"]` | `DesignCredibility.tierLabel` |
| `analyze_trial_design(payload)` (route-shaped) | route body in `app/api/trials/design/route.ts` |

The eligibility split intentionally follows the same heading/bullet rules as
[`lib/trialMatcher/eligibility.ts`](../../../lib/trialMatcher/eligibility.ts)::`parseEligibility`
(used inside the patient matcher). `lib/sources/trialDesign.ts` keeps its own aligned
copy so the design/credibility feature is self-contained.

`backend/engines/` is excluded from the Next build, so this module has zero TypeScript
impact. Upstream files are unchanged; this specialization is additive.
