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

### Latest run

- Dataset: **SciFact curated sample (committed)** (60 case(s))
- Generated: 2026-07-10T22:32:17.331Z

#### Headline comparison

| System | Accuracy | Macro-F1 | Micro-F1 | Errored (scored NEI) | N |
| --- | ---: | ---: | ---: | ---: | ---: |
| PaperTrail | 58.3% | 51.5% | 58.3% | 2 | 60 |
| Claude-alone | 70.0% | 70.4% | 70.0% | 16 | 60 |

#### Per-system breakdown

### PaperTrail

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 100.0 | 10.0 | 18.2 | 20 |
| CONTRADICT | 48.6 | 90.0 | 63.2 | 20 |
| NEI | 71.4 | 75.0 | 73.2 | 20 |
| **macro** | | | 51.5 | 60 |
| **micro** | | | 58.3 | 60 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 2 | 14 | 4 |
| CONTRADICT | 0 | 18 | 2 |
| NEI | 0 | 5 | 15 |

**Accuracy:** 58.3%  ·  **Macro-F1:** 51.5%  ·  **Micro-F1:** 58.3%  ·  **N:** 60

### Claude-alone

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| SUPPORT | 85.7 | 60.0 | 70.6 | 20 |
| CONTRADICT | 78.9 | 75.0 | 76.9 | 20 |
| NEI | 55.6 | 75.0 | 63.8 | 20 |
| **macro** | | | 70.4 | 60 |
| **micro** | | | 70.0 | 60 |

| gold ↓ / pred → | SUPPORT | CONTRADICT | NEI |
| --- | ---: | ---: | ---: |
| SUPPORT | 12 | 1 | 7 |
| CONTRADICT | 0 | 15 | 5 |
| NEI | 2 | 3 | 15 |

**Accuracy:** 70.0%  ·  **Macro-F1:** 70.4%  ·  **Micro-F1:** 70.0%  ·  **N:** 60


<!-- BENCH:RESULTS:END -->

## What the latest run means (read this)

The run above is the **valid, balanced 60-case** committed sample (20 SUPPORT / 20 CONTRADICT /
20 NEI) — it supersedes an earlier invalid 10-case smoke that had sliced a single gold label.
The honest headline:

- **PaperTrail 58.3% accuracy** vs **Claude-alone 70.0%**. On SciFact, PaperTrail **loses** — and
  we are not hiding it.
- **Why:** the confusion matrix is unambiguous. PaperTrail's **SUPPORT recall is 10%** and its
  **CONTRADICT recall is 90%** — it aggressively flags discrepancies and maps SUPPORT → CONTRADICT.
  That is exactly the behavior of an engine tuned for the **opposite** task: clinical-trial
  **efficacy-magnitude** verification ("reduced events by 30%" recomputed against a registry), not
  general scientific-claim entailment (mechanisms, associations). SciFact is a **task mismatch**;
  applied outside its design envelope, the engine over-flags. We own that.
- **Two things do hold up, even here:** PaperTrail's **honest-abstention** is strong (NEI F1 73.2,
  precision 71.4 — when it can't verify, it says so), and it is far more **reliable** than the raw
  baseline — PaperTrail errored on **2/60** cases vs Claude-alone's **16/60** (raw Claude often
  returned prose instead of valid JSON; PaperTrail's Zod-validated pipeline did not).

**Bottom line:** we do **not** cite 58.3% as a headline capability number — it is the conservative
floor on a mismatched task. A fair benchmark uses **clinical-efficacy claims**
(`tests/fixtures/test-claims.json`), where recompute-from-registry actually applies and the
deterministic differentiator is exercised. Building that harness is tracked in the roadmap.

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
