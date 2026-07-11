# PaperTrail specialization of MultiVerS

`papertrail_aggregate.py` in this directory is a **PaperTrail-native specialization** of the
MultiVerS engine. This repo owns the vendored MultiVerS tree; rather than fork or fight the
upstream pipeline, we added one file that ports the **cross-source label aggregation** step
MultiVerS implies but never ships — in a deterministic, groundable form that satisfies
PaperTrail's moat rules and mirrors the TypeScript contract in
`lib/scieval/crossSourceAggregate.ts`.

**No other file in this engine is modified.** `papertrail_aggregate.py` is standalone,
stdlib-only Python (no MultiVerS install, no torch, no model download, no network), and this
whole directory is excluded from the Next build — so there is zero TypeScript/build impact.

---

## Why it exists

MultiVerS (`multivers/model.py::decode`, `label_lookup {0: CONTRADICT, 1: NEI, 2: SUPPORT}`)
scores **one** `{claim, abstract}` pair at a time: it emits a single SUPPORTS / REFUTES
(= CONTRADICT) / NEI label plus the rationale sentences of **that** abstract. `predict.py`
runs the model per `(claim, abstract)` row and writes **one label per abstract**.

What MultiVerS never does is **combine** the per-abstract labels for the *same* claim into a
claim-level verdict — there is no cross-source aggregation step in the shipped pipeline.
Downstream code is left to answer: *given SUPPORTS from paper A, REFUTES from paper B, NEI
from paper C, what does the body of evidence say?* That aggregate verdict is exactly what
PaperTrail's contradiction atlas needs.

PaperTrail's **moat rule** is: *no LLM in the verdict / numeric / ranking path.* So this file
ports the missing aggregation step **deterministically**: given the per-source
`{label, confidence}` already produced upstream (by the TS `lib/scieval` MultiVerS port — one
label per abstract), it computes a confidence-weighted tally over the MultiVerS taxonomy and
classifies the claim into `supported / refuted / mixed / insufficient`.

| MultiVerS step | `papertrail_aggregate.py` |
| --- | --- |
| `label_lookup {0:CONTRADICT, 1:NEI, 2:SUPPORT}` (`model.py::decode`) | same taxonomy, SciFact-facing names `SUPPORTS / REFUTES / NEI` — the exact vocab `lib/scieval/schemas.ts::ScievalLabel` exposes |
| one label **per abstract** (`predict.py`) | consumes those per-abstract labels as input `{id, label, confidence?}` |
| *(missing)* combine labels for one claim | `aggregate_cross_source()` — confidence-weighted tally + rule-based verdict |
| NEI class = "not enough info" | NEI mass never nudges the support/refute direction; all-NEI/empty → `insufficient` |

---

## Native TS mapping

| Python (`papertrail_aggregate.py`) | TypeScript (`lib/scieval/crossSourceAggregate.ts`) |
| --- | --- |
| `aggregate_cross_source(payload)` | `aggregateCrossSource(perSource[])` |
| `classify(support, refute, nei)` | `classify(supportMass, refuteMass)` |
| `DEFAULT_CONFIDENCE = 1.0` | `DEFAULT_CONFIDENCE = 1.0` |
| `DOMINANCE_THRESHOLD = 0.7` | `DOMINANCE_THRESHOLD = 0.7` |
| output `{verdict, supportCount, refuteCount, neiCount, netConfidence, mixed, netDirection, tally, consideredCount}` | `CrossSourceAggregate` (same fields) |

Every constant is **FIXED** and **identical** across the two files, so the Python engine is an
exact by-hand cross-check of the TS hot path used by the public route
`app/api/scieval/aggregate/route.ts`.

---

## What it computes (all deterministic)

1. **Weighted tally** — each source contributes its `confidence` (default `1.0`, clamped to
   `[0, 1]`) to its label's mass: `supportMass`, `refuteMass`, `neiMass`. NEI accumulates the
   NEI mass **only** and never nudges the support/refute direction.
2. **Verdict** — `classify`: the directional (`support + refute`) mass decides.
   - no directional mass at all (only NEI, or no sources) → `insufficient`
   - one side holds ≥ `DOMINANCE_THRESHOLD` of the directional mass → `supported` / `refuted`
   - directional mass present but neither side dominates → `mixed`
3. **Net direction** — `netConfidence` in `[-1, 1]`: `(support − refute) / directional`.
   `+1` unanimous support, `−1` unanimous refute, `0` balanced. NEI is excluded from the
   denominator because it makes no directional claim. `netDirection` is its sign
   (`support` / `refute` / `none`).

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network. Same input → same output, always.
- **No LLM in the verdict** — the aggregate verdict, the tally, and every number are decided
  by rule; Claude only assigned the per-abstract labels upstream (in `lib/scieval/verify.ts`).
- **Honest abstention** — an all-NEI or empty body of evidence returns `insufficient` rather
  than a forced directional verdict, mirroring MultiVerS's own NEI class and PaperTrail's
  "honest insufficient over a forced answer" rule.
- **Boundary validation** — an unknown label or a non-finite confidence is rejected as bad
  input (`{"error": ...}` + exit `2`), never silently coerced.

---

## How to run

```bash
python papertrail_aggregate.py --json '{
  "sources": [
    {"id": "pubmed:1", "label": "SUPPORTS", "confidence": 0.9},
    {"id": "pubmed:2", "label": "SUPPORTS", "confidence": 0.8},
    {"id": "ctgov:NCT1", "label": "REFUTES", "confidence": 0.4},
    {"id": "pubmed:3", "label": "NEI"}
  ]
}'
```

Reads JSON on `--json` or stdin; prints one JSON object to stdout mirroring
`CrossSourceAggregate` (`verdict`, `supportCount`, `refuteCount`, `neiCount`, `netConfidence`,
`mixed`, `netDirection`, `tally`, `consideredCount`). On invalid input it prints
`{"error": "..."}` to stdout and exits `2`.
