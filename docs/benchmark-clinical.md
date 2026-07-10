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

<!-- BENCH:RESULTS:START -->

### Latest run

- Dataset: **Clinical-efficacy claims (committed, PaperTrail's design task)** (12 case(s))
- Generated: 2026-07-10T23:09:48.913Z

#### Headline comparison

| System | Accuracy | Macro-F1 | Micro-F1 | Errored (scored NEI) | N |
| --- | ---: | ---: | ---: | ---: | ---: |
| PaperTrail | 100.0% | 100.0% | 100.0% | 0 | 12 |
| Claude-alone | 100.0% | 100.0% | 100.0% | 0 | 12 |

#### Per-system breakdown

### PaperTrail

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 100.0 | 100.0 | 4 |
| CONTRADICT | 100.0 | 100.0 | 100.0 | 6 |
| NEI | 100.0 | 100.0 | 100.0 | 2 |
| **macro** | | | 100.0 | 12 |
| **micro** | | | 100.0 | 12 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 4 | 0 | 0 |
| CONTRADICT | 0 | 6 | 0 |
| NEI | 0 | 0 | 2 |

**Accuracy:** 100.0%  ·  **Macro-F1:** 100.0%  ·  **Micro-F1:** 100.0%  ·  **N:** 12

### Claude-alone

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 100.0 | 100.0 | 4 |
| CONTRADICT | 100.0 | 100.0 | 100.0 | 6 |
| NEI | 100.0 | 100.0 | 100.0 | 2 |
| **macro** | | | 100.0 | 12 |
| **micro** | | | 100.0 | 12 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 4 | 0 | 0 |
| CONTRADICT | 0 | 6 | 0 |
| NEI | 0 | 0 | 2 |

**Accuracy:** 100.0%  ·  **Macro-F1:** 100.0%  ·  **Micro-F1:** 100.0%  ·  **N:** 12


<!-- BENCH:RESULTS:END -->

## Reading it honestly

Two honest takeaways, and one thing this run does **not** show:

1. **PaperTrail is fit for its purpose.** It scored **100%** on the efficacy-magnitude task it is
   built for — versus **58.3%** on the mismatched general-entailment SciFact task ([benchmark.md](./benchmark.md)).
   That gap _is_ the point: the engine works where recompute-from-registry and exact-span grounding
   apply, and honestly over-flags where they don't.
2. **On this set it does not beat the LLM baseline — it ties it.** Claude-alone also scored 100%.
   The distortions here (50% vs 25%, "all patients" vs an excluded subgroup, primary-not-significant)
   are clear enough that a plain LLM catches them too. So this run demonstrates **fitness for task**,
   not **marginal advantage over Claude-alone**.
3. **What would separate them is harder cases** — subtle magnitude drift a fluent LLM waves through
   as a "reasonable paraphrase" but exact recompute catches (e.g. a claimed "30% reduction" when the
   registry HR is 0.75 = 25%), plus reliability under adversarial/edge inputs (where PaperTrail's
   Zod-validated pipeline already showed 2/60 errors vs Claude-alone's 16/60 on SciFact). A larger,
   subtler, independently-curated set is future work.

This is a small curated set (a dozen cases) — a **directional** signal, not a large-N leaderboard.
Cases are self-consistent by construction and the trial numbers are real and public. It establishes
the fair-task framing the general SciFact number cannot, without over-claiming a win the data
doesn't support.
