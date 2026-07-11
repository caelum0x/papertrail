# PaperTrail Multi-Source (Contested-Evidence) Benchmark

_The fair test of the **Mixture of Agents**: each claim is judged against SEVERAL real trials (agreeing or conflicting), so the composing agents (MultiVerS aggregation, PyMARE pooling, STORM debate) actually fire — unlike the single-source set. Claude-alone sees the same concatenated sources, isolating whether the composition reasons over the totality better._

- Cases: **8**
- Run: `MOA fixture` via `npx tsx scripts/benchmark/multisource.ts`

## Headline comparison

| System | Accuracy | Macro-F1 | Micro-F1 | Errored (NEI) | N |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mixture of Agents | 100.0% | 66.7% | 100.0% | 0 | 8 |
| Claude-alone | 100.0% | 66.7% | 100.0% | 0 | 8 |

(Macro-F1 is 66.7% only because this set has **no NEI cases** — both systems are perfect on the
two populated classes; macro averages in the empty NEI class as F1=0.)

## Interpreting this result (honest)

**The Mixture of Agents did NOT beat Claude-alone here — both got 8/8.** We report that plainly.
Given all the sources and a "judge the totality of the evidence" prompt, a strong frontier model
(Opus 4.8) correctly handled every contested multi-trial case, including the aggregate reversals
(niacin, intensive BP in diabetics, HRT, beta-carotene) and the over-generalized class claim.

Taken with the single-source set (MoA 85% < Claude-alone 90% < deterministic PaperTrail 95%), the
honest conclusion is: **the MoA's value is not a raw-accuracy edge over a strong LLM on these
tasks.** Where the composition earns its place is the part a benchmark score doesn't show:

- **Reproducibility** — the verdict + trust come from deterministic math over the agents' votes, so
  the same inputs always yield the same number. Claude-alone's 100% here can drift run-to-run; the
  MoA's mix cannot.
- **Decomposable provenance** — every verdict breaks down into which agent voted, which source it
  cited, and which effect size was pooled, each grounded to a verbatim span. Claude-alone returns a
  label with no auditable trail.
- **Deterministic effect-size math** — the magnitude/pooling agents recompute the numbers rather
  than trusting a model to eyeball them, which matters at scale and for regulated, defensible use.

That auditability — not a leaderboard number — is the actual moat. **Caveat:** 8 hand-built cases
with no NEI is a tiny set; a larger, harder, NEI-inclusive benchmark could still separate the systems
on accuracy, but we will not claim a win the data doesn't show.

## Per-case predictions

| Case | Gold | Mixture of Agents | Claude-alone |
| --- | --- | --- | --- |
| statins-mace-support | SUPPORT | SUPPORT | SUPPORT |
| sglt2-hf-support | SUPPORT | SUPPORT | SUPPORT |
| pcsk9-mace-support | SUPPORT | SUPPORT | SUPPORT |
| niacin-cv-refuted | CONTRADICT | CONTRADICT | CONTRADICT |
| intensive-bp-diabetes-refuted | CONTRADICT | CONTRADICT | CONTRADICT |
| hrt-chd-refuted | CONTRADICT | CONTRADICT | CONTRADICT |
| betacarotene-lungcancer-refuted | CONTRADICT | CONTRADICT | CONTRADICT |
| sglt2-class-cvdeath-overgeneralized | CONTRADICT | CONTRADICT | CONTRADICT |

_Bold = disagreed with gold._

### Mixture of Agents

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 100.0 | 100.0 | 3 |
| CONTRADICT | 100.0 | 100.0 | 100.0 | 5 |
| NEI | 0.0 | 0.0 | 0.0 | 0 |
| **macro** | | | 66.7 | 8 |
| **micro** | | | 100.0 | 8 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 3 | 0 | 0 |
| CONTRADICT | 0 | 5 | 0 |
| NEI | 0 | 0 | 0 |

**Accuracy:** 100.0%  ·  **Macro-F1:** 66.7%  ·  **Micro-F1:** 100.0%  ·  **N:** 8

### Claude-alone

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 100.0 | 100.0 | 3 |
| CONTRADICT | 100.0 | 100.0 | 100.0 | 5 |
| NEI | 0.0 | 0.0 | 0.0 | 0 |
| **macro** | | | 66.7 | 8 |
| **micro** | | | 100.0 | 8 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 3 | 0 | 0 |
| CONTRADICT | 0 | 5 | 0 |
| NEI | 0 | 0 | 0 |

**Accuracy:** 100.0%  ·  **Macro-F1:** 66.7%  ·  **Micro-F1:** 100.0%  ·  **N:** 8

