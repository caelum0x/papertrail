# PaperTrail specialization of ASReview (Ensemble Screening)

`papertrail_ensemble.py` in this directory is a **PaperTrail-native specialization** of
the ASReview engine. This repo owns the vendored ASReview tree; rather than fork or run
upstream's active-learning server, we added one file that re-implements ASReview's
**deterministic screening core** — `Tfidf` feature extraction + `MultinomialNB`
classifier — but runs it across **three label axes in a single pass** and combines them
into one screening priority.

**No other file in this engine is modified.** `papertrail_ensemble.py` is standalone,
stdlib-only Python (no `sklearn`, no `numpy`, no ASReview install, no model download, no
network), and this whole directory is excluded from the Next build — so there is zero
TypeScript/build impact.

---

## Why it exists

ASReview screens systematic-review title/abstracts on **one** axis — relevant vs.
irrelevant — with the loop `Tfidf → MultinomialNB → Max query` (already ported, single
axis, in `lib/screening/activeLearning.ts`). But a reviewer building an evidence table
makes **three** judgements about each abstract:

| Axis | Question | Positive class (ranked up) |
| --- | --- | --- |
| `include` | Is this study in scope? | in scope (`include = 1`) |
| `quality` | Is it methodologically sound? | high quality (`quality = 1`) |
| `rob` | Can we trust its effect estimate? | **low** risk of bias (`rob = 0`) |

Running three separate screening passes is wasteful and gives the reviewer three
disjoint worklists. This engine runs ASReview's exact deterministic core **three times
over one shared vocabulary** — one independent `MultinomialNB` head per axis — then
folds the three posteriors into **one** `priority` and records which axis drove it
(`deciding_axis`), so the reviewer has a single, explainable worklist.

Upstream ASReview's default model
(`asreview/models/feature_extraction` + `asreview/models/classifiers`) is
`TfidfVectorizer → MultinomialNB(alpha=1.0) → Max`. PaperTrail's **moat rule** is: *no
LLM, and no non-reproducible numeric path, anywhere in a score/ranking/verdict.* So this
file keeps ASReview's exact math and drops nothing deterministic:

| ASReview step | `papertrail_ensemble.py` |
| --- | --- |
| `Tfidf` feature extractor (sklearn `TfidfVectorizer`) | `fit_tfidf` / `transform_tfidf` — smooth_idf, use_idf, L2 row norm, `token_pattern` `\b\w\w+\b`, lowercased |
| `NaiveBayes` classifier (`MultinomialNB`, alpha=1.0) | `fit_naive_bayes` / `predict_positive` — Laplace smoothing, class log-priors, stable softmax |
| `Max` query strategy (rank by P descending) | stable sort by `priority` descending |
| single relevance axis | **three** axes (`include`, `quality`, `rob`), each its own NB head over the shared TF-IDF vocabulary |
| — | `_decide_priority` — the combined-priority + deciding-axis **boundary** |

---

## The boundary that decides the ranking

The ranking is decided **entirely** by `_decide_priority(scores)` (Python) /
`decidePriority(scores)` (TS). Given the per-axis positive-class posteriors:

```
priority     = Σ_axis  weight[axis] · score[axis]   /   Σ_axis weight[axis]
                (summed over the TRAINED axes only)

deciding_axis = argmax_axis ( weight[axis] · score[axis] )
                (ties break by the fixed axis order: include > quality > rob)
```

with the fixed weights

```
weight = { include: 0.5, quality: 0.3, rob: 0.2 }
```

**Rationale for the boundary:** `include` dominates (scope is the gate — an out-of-scope
abstract should never top the list on quality alone); `quality` and low-`rob` refine the
ordering *within* scope. Renormalising by the sum of the *used* weights means an
**untrained** axis neither inflates nor deflates the priority — a batch labeled only on
`include` produces the exact single-axis ASReview ordering. `deciding_axis` names the
axis whose weighted contribution was largest, so the reviewer can see *why* an abstract
rose (e.g. "ranked high because it's clearly in scope" vs. "ranked high because it's
low-bias"). This is pure math + fixed rules — **no LLM** picks the priority or the axis.

### `rob` polarity (important)

The input encodes `rob = 1` as **HIGH** risk of bias. Internally the positive
(priority-raising) class is **LOW** RoB, so both the Python (`_axis_positive`) and the TS
(`axisPositive`) invert it: `positive = 1 - rob`. A low-RoB abstract therefore scores
**high** on `rob_score` / `robScore`, consistent with `include`/`quality` where 1 is the
good outcome. Keep the two mappings identical or the axis flips.

---

## PaperTrail invariants it enforces

- **Deterministic** — no randomness, no network, no model file. Same labels + same
  unlabeled pool → same posteriors → same ranking, always. There is **no LLM** in any
  posterior, priority, or ordering. Claude never touches this path.
- **Honest untrained axis** — an axis with fewer than **both** classes present among the
  labels is **skipped** (not fit on one-sided data). It contributes nothing to
  `priority` and its per-axis score is reported as `0`. `meta.axes_trained` lists exactly
  which axes had signal.
- **Honest empty ranking** — no labeled or no unlabeled abstracts, a labeled set with no
  usable tokens, or no axis with two-class signal, all yield an **empty** `ranking`
  rather than a fabricated order.
- **Drop, never coerce** — malformed labeled/unlabeled items are dropped at parse time
  (a labeled item needs non-empty `text` and `include ∈ {0,1}`; an unlabeled item needs
  non-empty `id` and `text`; `quality`/`rob` are kept only when `∈ {0,1}`).
- **Boundary failure is explicit** — unreadable/invalid JSON input is reported as
  `{"error": ...}` on stdout with exit code `2`, never a silent crash.

---

## Field-for-field mapping to the native TS module

`lib/screening/ensemble.ts` is the **TypeScript mirror** the app actually serves from.
It reuses the sklearn-faithful primitives already ported in
`lib/screening/activeLearning.ts` (which it does **not** edit) and adds the ensemble +
boundary on top.

| `papertrail_ensemble.py` | `lib/screening/ensemble.ts` |
| --- | --- |
| `tokenize` / `fit_tfidf` / `transform_tfidf` | reuses `tokenize` / `fitTfidf` / `transformTfidf` from `activeLearning.ts` |
| `fit_naive_bayes` / `predict_positive` | reuses `fitNaiveBayes` / `predictRelevance` from `activeLearning.ts` |
| `_AXES` | `AXES` |
| `_AXIS_WEIGHTS` | `AXIS_WEIGHTS` |
| `_axis_positive` | `axisPositive` |
| `_decide_priority` | `decidePriority` |
| `ensemble_screen` | `ensembleScreen(labeled, unlabeled)` |

Output shape (identical field-for-field, snake_case in Python / camelCase in TS):

| Python JSON field | TS `EnsembleScore` / `EnsembleResult` field |
| --- | --- |
| `ranking[].id` | `ranking[].id` |
| `ranking[].include_score` | `ranking[].includeScore` |
| `ranking[].quality_score` | `ranking[].qualityScore` |
| `ranking[].rob_score` | `ranking[].robScore` |
| `ranking[].priority` | `ranking[].priority` |
| `ranking[].deciding_axis` | `ranking[].decidingAxis` |
| `meta.labeled` | `meta.labeled` |
| `meta.unlabeled` | `meta.unlabeled` |
| `meta.vocabulary_size` | `meta.vocabularySize` |
| `meta.axes_trained` | `meta.axesTrained` |

The public route `app/api/screening/ensemble/route.ts` (runtime `nodejs`, IP
`checkRateLimit`, Zod `safeParse`, `ok`/`fail` envelope, try/catch, logs ids/counts only)
accepts `POST { labeled: [{text, include, quality?, rob?}], unlabeled: [{id, text}] }`
and returns the `EnsembleResult`.

---

## How to invoke

Standalone, stdlib only (no install):

```bash
# 1. Batch as JSON on stdin.
echo '{"labeled":[{"text":"randomized controlled trial of drug x reduced events","include":1,"quality":1,"rob":0},
                   {"text":"in vitro assay of unrelated compound","include":0,"quality":0,"rob":1}],
       "unlabeled":[{"id":"a","text":"randomized trial of drug x reduced events"},
                    {"id":"b","text":"editorial opinion about drug x"}]}' \
  | python3 papertrail_ensemble.py

# 2. Batch from a file.
python3 papertrail_ensemble.py --input-file batch.json
```

### Extending / tuning

The `_AXES`, `_AXIS_WEIGHTS`, and the `_NB_ALPHA` smoothing constant are the
reproducibility contract. If you change any of them you **must** change it identically in
`lib/screening/ensemble.ts` (and the shared primitives in
`lib/screening/activeLearning.ts`) — a drift between the two would let the offline Python
screener and the on-demand TypeScript screener rank the same batch differently.
```
