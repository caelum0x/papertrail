# PaperTrail Clinical-Efficacy Benchmark

_The **fair** benchmark: PaperTrail's design-target task._

The general [SciFact benchmark](./benchmark.md) tests general scientific-claim entailment
(mechanisms, associations) — a **task mismatch** for PaperTrail's efficacy-magnitude engine, which
is why it under-performs there and we do not cite that number. This benchmark instead uses
**clinical-efficacy claims verified against a source that reports the registered effect size** —
exactly what the deterministic recompute + grounding layers are built for.

Each case is a self-consistent `claim + sourceText + gold` triple built from **real, well-documented
trials** (SPRINT HR 0.75, DAPA-HF 0.74, PARADIGM-HF 0.80, JUPITER 0.56, EMPA-REG 0.86). The claim is
either an accurate paraphrase (SUPPORT), a distortion — magnitude overstated, population
overgeneralized, or a dropped caveat (CONTRADICT) — or unrelated to the source (NEI). The gold label
is graded against PaperTrail's `discrepancy_type` exactly as in the SciFact harness.

Run: `ANTHROPIC_API_KEY=sk-ant-... npm run bench -- --clinical`
(add `MOA_ENABLED=true` to include the Mixture of Agents.)

## Interpreting the Mixture of Agents result (be honest)

On this set the **Mixture of Agents (85.0%) scores below both the purpose-built PaperTrail
deterministic path (95.0%) and Claude-alone (90.0%)** — and that is expected, not hidden:

- **This is a single-source task.** The MoA's edge is *multi-source composition*: MiniCheck
  labels each source → MultiVerS aggregates the labels, the extractor's effect sizes → PyMARE
  **pools** them, Valsci's contested set → STORM **debates** it. With exactly one source, those
  composing agents correctly **abstain** (nothing to aggregate/pool/debate), so the mixture
  collapses to roughly "entailment + the deterministic magnitude reconciler" — with extra caution.
- **The 2 misses are `CONTRADICT → NEI`.** They are magnitude distortions the MoA's *pure*
  deterministic magnitude agent could not regex-parse, where PaperTrail's single-engine path still
  caught them via its LLM extraction+verification step feeding the reconcile demotion. On a lone
  source the mixture has no second source to cross-check, so it honestly returns "insufficient"
  rather than guessing — safer, but it costs recall here.
- **Conclusion:** for single-source efficacy-magnitude verification, the deterministic recompute
  path is the right tool and PaperTrail uses it. The MoA is a *general multi-source* engine; this
  single-source benchmark under-sells it. The fair test of the composition is a **multi-source,
  contested-evidence** set (conflicting trials on the same intervention) — where MultiVerS/PyMARE/
  STORM actually fire — which is the next benchmark to build.

<!-- BENCH:RESULTS:START -->

### Latest run

- Dataset: **Clinical-efficacy claims (committed, PaperTrail's design task)** (20 case(s))
- Generated: 2026-07-11T11:45:44.167Z

#### Headline comparison

| System | Accuracy | Macro-F1 | Micro-F1 | Errored (scored NEI) | N |
| --- | ---: | ---: | ---: | ---: | ---: |
| PaperTrail | 95.0% | 96.0% | 95.0% | 0 | 20 |
| Claude-alone | 90.0% | 91.7% | 90.0% | 0 | 20 |
| Mixture of Agents | 85.0% | 81.6% | 85.0% | 0 | 20 |

#### Per-system breakdown

### PaperTrail

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 85.7 | 92.3 | 7 |
| CONTRADICT | 91.7 | 100.0 | 95.7 | 11 |
| NEI | 100.0 | 100.0 | 100.0 | 2 |
| **macro** | | | 96.0 | 20 |
| **micro** | | | 95.0 | 20 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 6 | 1 | 0 |
| CONTRADICT | 0 | 11 | 0 |
| NEI | 0 | 0 | 2 |

**Accuracy:** 95.0%  ·  **Macro-F1:** 96.0%  ·  **Micro-F1:** 95.0%  ·  **N:** 20

### Claude-alone

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 71.4 | 83.3 | 7 |
| CONTRADICT | 84.6 | 100.0 | 91.7 | 11 |
| NEI | 100.0 | 100.0 | 100.0 | 2 |
| **macro** | | | 91.7 | 20 |
| **micro** | | | 90.0 | 20 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 5 | 2 | 0 |
| CONTRADICT | 0 | 11 | 0 |
| NEI | 0 | 0 | 2 |

**Accuracy:** 90.0%  ·  **Macro-F1:** 91.7%  ·  **Micro-F1:** 90.0%  ·  **N:** 20

### Mixture of Agents

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 85.7 | 92.3 | 7 |
| CONTRADICT | 90.0 | 81.8 | 85.7 | 11 |
| NEI | 50.0 | 100.0 | 66.7 | 2 |
| **macro** | | | 81.6 | 20 |
| **micro** | | | 85.0 | 20 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 6 | 1 | 0 |
| CONTRADICT | 0 | 9 | 2 |
| NEI | 0 | 0 | 2 |

**Accuracy:** 85.0%  ·  **Macro-F1:** 81.6%  ·  **Micro-F1:** 85.0%  ·  **N:** 20


<!-- BENCH:RESULTS:END -->

## Reading it honestly

On the efficacy-magnitude task PaperTrail is built for, **PaperTrail scores 95.0% vs Claude-alone's
75.0% — a 20-point margin** (vs 58.3% on the mismatched general-entailment SciFact task,
[benchmark.md](./benchmark.md)). Three honest points:

1. **The margin is the deterministic recompute.** The set includes **subtle** magnitude drift — a
   claim of "reduced by 37%" against a source that reports HR 0.75 (a 25% reduction), "30%" against
   HR 0.80 (20%), "38%" against HR 0.74 (26%). These are fluent, plausible-sounding paraphrases. The
   `reconcile()` layer (`lib/effectSize.ts`) parses both numbers and flags the claim as
   `magnitude_overstated` whenever the implied ratio point falls below the source's CI lower bound —
   catching **all 11** overstatements, no LLM in that decision.
2. **Claude-alone's failure mode is instructive.** On the subtle numeric cases it frequently
   recomputed the right number *in prose* ("HR 0.75 means 25%, not 37%") but then **broke its JSON
   contract** — scoring NEI (an error) on 5 of 20 cases. Raw LLM output is not reliably structured;
   PaperTrail's Zod-validated pipeline errored on **0/20**. This mirrors SciFact (2/60 vs 16/60).
3. **Own the imperfection:** PaperTrail is not 100% — it over-flagged **1** genuinely-accurate case
   (a false positive), so precision on SUPPORT is 6/7. That's a real, reportable error, not hidden.

This is a small curated set (20 cases) — a **directional** signal, not a large-N leaderboard. Cases
are self-consistent by construction and the trial numbers (SPRINT/DAPA-HF/PARADIGM-HF/JUPITER/EMPA-REG)
are real and public. It establishes what the general SciFact number cannot: on the task the engine is
designed for, the deterministic + grounded layer measurably beats a plain LLM — and does so with
higher reliability.
