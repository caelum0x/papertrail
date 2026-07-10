---
name: papertrail-evidence-synthesis
description: Pool multiple study effect sizes into a random-effects meta-analysis and produce a GRADE-rated evidence report. Use when a scientist has 2+ trials (as risk/odds/hazard ratios with CIs or 2x2 counts) and wants a pooled estimate, heterogeneity, and a Summary-of-Findings verdict.
---

# PaperTrail: Evidence Synthesis (Meta-Analysis + GRADE)

Pool study-level effects into a single deterministic meta-analysis, optionally
comparing a claimed magnitude against the pooled effect, and generate a
GRADE-style evidence report (Summary of Findings).

## Hard guarantees (state these to the user)

- **Deterministic recompute** — the pooled estimate, confidence interval, and
  heterogeneity (I², tau²) are computed by a fixed statistical engine. Same
  inputs, same numbers, every run. No LLM invents the statistics.
- **Exact-span / traceable inputs** — each study you supply is carried through
  the pool by its `label`; the verdict compares the claim to the pool it
  actually built, so every number traces back to an input row.
- **Honest insufficiency** — if fewer than two studies yield a usable
  log-effect, the engine says so ("fewer than two usable studies") rather than
  reporting a meaningless pool.

## Step 1 — Assemble the studies

Each study needs **either** a ratio-scale point estimate + CI **or** the four
2x2 counts:

- Point + CI: `label`, `point` (>0), `ci_lower` (>0), `ci_upper` (>0), and
  optionally `ci_pct` (default 95; 50–99.9).
- 2x2 counts: `label`, `events1`, `total1` (treatment arm), `events2`, `total2`
  (control arm).

## Step 2 — Pool the studies (`meta_analysis`)

Call the **`meta_analysis`** MCP tool.

Inputs:
- `claim` (string) — the magnitude claim to test against the pool, e.g.
  `"The drug reduces mortality by about 25%."`
- `studies` (array, 2–100) — the study objects from Step 1.

Report the pooled effect + CI, heterogeneity, `k`, and the claim-vs-pool
verdict (is the claimed magnitude supported by the pooled evidence?).

## Step 3 — GRADE evidence report (`evidence_report`)

For a Summary-of-Findings table with certainty rating, call the
**`evidence_report`** MCP tool.

Inputs:
- `claim` (string) and `studies` (same array as above).
- Optional: `risk_of_bias_steps`, `indirectness_steps` (GRADE downgrade
  reasons), `baselineRisk` (to derive absolute effects).

Report the pooled relative effect, the **absolute** effect at baseline risk,
and the **GRADE certainty** (high/moderate/low/very low) with the downgrade
rationale.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. No API key required.

Meta-analysis:

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/synthesis \
  -H 'Content-Type: application/json' \
  -d '{
    "claim": "The drug reduces major events by about 25%.",
    "studies": [
      { "label": "TRIAL-A 2021", "point": 0.78, "ci_lower": 0.66, "ci_upper": 0.92 },
      { "label": "TRIAL-B 2023", "events1": 41, "total1": 1200, "events2": 63, "total2": 1190 }
    ]
  }'
```

GRADE evidence report:

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/evidence-report \
  -H 'Content-Type: application/json' \
  -d '{
    "claim": "The drug reduces major events by about 25%.",
    "studies": [
      { "label": "TRIAL-A 2021", "point": 0.78, "ci_lower": 0.66, "ci_upper": 0.92 },
      { "label": "TRIAL-B 2023", "point": 0.71, "ci_lower": 0.55, "ci_upper": 0.90 }
    ],
    "baselineRisk": 0.08
  }'
```

Both return the standard `{ success, data, error }` envelope.

## Notes

- Ratios must be on a consistent scale (all RR, or all OR, or all HR). Do not
  mix hazard ratios with odds ratios in one pool.
- For dose-response, network, or subgroup meta-analysis, use the corresponding
  PaperTrail tools (`dose_response_analysis`, `network_meta_analysis`,
  `subgroup_analysis`) instead.
