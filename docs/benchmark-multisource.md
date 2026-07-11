# PaperTrail Multi-Source (Contested-Evidence) Benchmark

_The fair test of the **Mixture of Agents**: each claim is judged against SEVERAL real trials (agreeing or conflicting), so the composing agents (MultiVerS aggregation, PyMARE pooling, STORM debate) actually fire — unlike the single-source set. Claude-alone sees the same concatenated sources, isolating whether the composition reasons over the totality better._

- Cases: **8**
- Run: `MOA fixture` via `npx tsx scripts/benchmark/multisource.ts`

## Headline comparison

| System | Accuracy | Macro-F1 | Micro-F1 | Errored (NEI) | N |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mixture of Agents | 100.0% | 66.7% | 100.0% | 0 | 8 |
| Claude-alone | 100.0% | 66.7% | 100.0% | 0 | 8 |

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

