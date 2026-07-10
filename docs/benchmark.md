# PaperTrail Benchmark

_How well does PaperTrail actually do?_ This is the open, reproducible answer.

PaperTrail verifies a scientific/clinical claim against its primary source and returns
a verdict (`accurate`, `magnitude_overstated`, `population_overgeneralized`,
`caveat_dropped`, or `no_support_found`). The benchmark measures how often that verdict
is _right_ on a real, labeled dataset — and, critically, whether the deterministic
engine buys anything over just asking Claude.

The results are filled in by the runner (`scripts/benchmark/run.ts`); the methodology
below is fixed.

<!-- BENCH:RESULTS:START -->

> ⚠️ **DO NOT CITE THE RUN BELOW.** It is an invalid smoke run: only 10 cases, and they
> are all a single gold label (SUPPORT), because it sliced the top of the fixture. More
> fundamentally, **SciFact is a task mismatch** — it tests general scientific-claim
> entailment (mechanisms/associations), whereas PaperTrail's engine verifies clinical-trial
> *efficacy-magnitude* claims (recompute-from-registry). PaperTrail aggressively flags
> discrepancies, which maps SUPPORT→CONTRADICT here. A fair benchmark must use clinical
> efficacy claims (see tests/fixtures/test-claims.json), not SciFact.

### Latest run

- Dataset: **SciFact curated sample (committed)** (10 case(s))
- Generated: 2026-07-10T10:35:34.788Z

#### Headline comparison

| System | Accuracy | Macro-F1 | Micro-F1 | Errored (scored NEI) | N |
| --- | ---: | ---: | ---: | ---: | ---: |
| PaperTrail | 20.0% | 11.1% | 20.0% | 0 | 10 |
| Claude-alone | 60.0% | 25.0% | 60.0% | 3 | 10 |

#### Per-system breakdown

### PaperTrail

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 20.0 | 33.3 | 10 |
| CONTRADICT | 0.0 | 0.0 | 0.0 | 0 |
| NEI | 0.0 | 0.0 | 0.0 | 0 |
| **macro** | | | 11.1 | 10 |
| **micro** | | | 20.0 | 10 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 2 | 7 | 1 |
| CONTRADICT | 0 | 0 | 0 |
| NEI | 0 | 0 | 0 |

**Accuracy:** 20.0%  ·  **Macro-F1:** 11.1%  ·  **Micro-F1:** 20.0%  ·  **N:** 10

### Claude-alone

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 60.0 | 75.0 | 10 |
| CONTRADICT | 0.0 | 0.0 | 0.0 | 0 |
| NEI | 0.0 | 0.0 | 0.0 | 0 |
| **macro** | | | 25.0 | 10 |
| **micro** | | | 60.0 | 10 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 6 | 0 | 4 |
| CONTRADICT | 0 | 0 | 0 |
| NEI | 0 | 0 | 0 |

**Accuracy:** 60.0%  ·  **Macro-F1:** 25.0%  ·  **Micro-F1:** 60.0%  ·  **N:** 10


<!-- BENCH:RESULTS:END -->

## Methodology

### Dataset — SciFact

We use [SciFact](https://github.com/allenai/scifact) (Wadden et al., 2020), a benchmark
of expert-written scientific claims, each paired with abstracts from a corpus of
research papers and labeled evidence. It is the closest public dataset to PaperTrail's
job: decide whether a source _supports_, _contradicts_, or _does not address_ a claim.

The release lives (gitignored) at `reference/scifact/data/data/`:

- `claims_{train,dev,test}.jsonl` — one claim per line.
- `corpus.jsonl` — one abstract per line.

SciFact claim shape:

```jsonc
{
  "id": 3,
  "claim": "1,000 genomes project enables mapping of ... rare variants ...",
  "evidence": { "14717500": [{ "sentences": [2, 5], "label": "SUPPORT" }] },
  "cited_doc_ids": [14717500]
}
```

Corpus doc shape: `{ "doc_id": 4983, "title": "...", "abstract": ["sentence", ...] }`.

An **empty `evidence` object means NOT ENOUGH INFO (NEI)** — the cited source does not
establish the claim.

### Mapping SciFact → PaperTrail

Each SciFact claim becomes one `BenchmarkCase` (`lib/eval/benchmarkTypes.ts`):

| SciFact | PaperTrail |
| --- | --- |
| the cited corpus doc(s) | the SOURCE — `sourceText = title + "\n" + abstract.join(" ")`, docs joined |
| evidence label `SUPPORT` | gold label **SUPPORT** |
| evidence label `CONTRADICT` | gold label **CONTRADICT** |
| empty `evidence` | gold label **NEI** |

PaperTrail's verdict maps _back_ onto the three-way label:

| PaperTrail `discrepancy_type` | Predicted label |
| --- | --- |
| `accurate` | **SUPPORT** |
| `magnitude_overstated` | **CONTRADICT** |
| `population_overgeneralized` | **CONTRADICT** |
| `caveat_dropped` | **CONTRADICT** |
| `no_support_found` / no confident match | **NEI** |

The three distortion verdicts all collapse to `CONTRADICT`: each is a case where the
tool found the source does _not_ back the claim as stated. `no_support_found` is the
honest "couldn't verify" — mapped to NEI rather than forced into a confident answer,
matching PaperTrail's core rule that a wrong "confident" answer is worse than an honest
abstention.

Loading and this mapping live in `scripts/benchmark/scifact.ts`; every case is validated
through a Zod schema at load time (`benchmarkCaseSchema`), so a malformed row fails
loudly rather than silently skewing the numbers.

### Systems compared

Three systems produce a predicted label for each case:

1. **PaperTrail** — the real verification path, DB-free for the benchmark:
   1. **Extraction** — Claude extracts a structured finding (effect size, population,
      condition, endpoint, caveats) from the source (`ExtractedFindingSchema`).
   2. **Verification** — Claude compares the claim to that finding and the full source
      and returns a `discrepancy_type`, `trust_score`, and `flagged_spans`
      (`VerificationResultSchema`).
   3. **Grounding** — every flagged span is checked to be a verbatim substring of the
      source; ungroundable spans are dropped (`lib/grounding.ts`).
   4. **Deterministic reconcile** — `lib/effectSize.ts` `reconcile()` runs on the raw
      numbers with no LLM in the loop. It can only **demote** an LLM `accurate` verdict
      to a rule-decidable distortion (`magnitude_overstated` / `caveat_dropped`) — never
      upgrade one — so an overstated magnitude the model missed still gets caught, and no
      "catch" is ever fabricated.

2. **Claude-alone (baseline)** — a single Claude call that classifies the claim vs the
   source directly into `SUPPORT` / `CONTRADICT` / `NEI`, with **no** extraction step,
   **no** grounding, and **no** deterministic engine. This isolates what PaperTrail's
   deterministic + grounding layers add over "just ask the model." Output is validated
   with Zod.

3. **MiniCheck (optional)** — the [MiniCheck](https://github.com/Liyan06/MiniCheck)
   entailment model via `lib/engines/minicheck.ts` `factCheck()`, opt-in with
   `MINICHECK_ENABLED=true` (needs a Python runtime + model weights). It is binary, so
   `supported → SUPPORT`, otherwise `CONTRADICT`. Skipped gracefully when disabled.

Per-case failures (a thrown LLM error, a subprocess timeout) are recorded and scored
**NEI** for that system — an honest "couldn't verify", never a fabricated pass. No claim
text or source text is ever logged, only the system name and a short error reason.

### Metrics

Scoring is pure and deterministic (`lib/eval/metrics.ts`) — no LLM is in the scoring
loop. From the (gold, predicted) label pairs we compute:

- **Confusion matrix** over `{SUPPORT, CONTRADICT, NEI}` (rows = gold, cols = predicted).
- **Per-class precision / recall / F1** with support.
- **Macro-F1** — unweighted mean of per-class F1 (each class counts equally; robust to
  class imbalance).
- **Micro-F1** — pooled TP/FP/FN across classes (equals accuracy in this single-label
  setting).
- **Accuracy** — fraction of cases with the correct label.

All divisions are zero-safe (a metric with no denominator is `0`, never `NaN`), so an
empty or degenerate run still yields a clean table.

### How to run

```bash
# Committed curated sample — runs on a fresh clone, no gitignored data needed.
npm run bench

# Full SciFact dev split (reads the gitignored reference/ dataset).
npm run bench -- --full

# Include MiniCheck (needs Python + model weights).
MINICHECK_ENABLED=true npm run bench
```

Requirements:

- `ANTHROPIC_API_KEY` in `.env.local` (see `.env.example`). Without it the runner exits
  with a clear message before making any call.
- `--full` requires the SciFact release extracted under
  `reference/scifact/data/data/` (gitignored — `reference/scifact/data/data.tar.gz`).
  The default `npm run bench` needs **none** of that; it reads the committed curated
  subset at `tests/fixtures/scifact-sample.json` (a balanced SUPPORT/CONTRADICT/NEI
  slice) so the benchmark is reproducible offline.

The runner prints the comparison table to the console and splices it into the RESULTS
section of this file, between the `BENCH:RESULTS` markers, leaving this methodology
section untouched.

### Reading the results honestly

- **PaperTrail vs Claude-alone** is the headline comparison. If PaperTrail does not beat
  the single-call baseline on macro-F1, the deterministic engine is not earning its
  complexity on this dataset — and that's worth knowing and reporting, not hiding.
- SciFact abstracts are short paper abstracts, not the ClinicalTrials.gov registered
  results the deterministic effect-size/registry layer is strongest on, so this is a
  **conservative** test of PaperTrail's differentiator: it measures the floor, not the
  ceiling.
- The curated sample is small (tens of cases) — treat its numbers as a smoke test.
  Run `--full` on the SciFact dev split for numbers worth quoting.
