# PaperTrail specialization of Valsci

`papertrail_conflict.py` in this directory is a **PaperTrail-native specialization** of the
Valsci engine. This repo owns the vendored Valsci tree; rather than fork or fight the
upstream pipeline, we added one file that ports Valsci's implied *contradiction-resolution
loop* into a deterministic, groundable form that satisfies PaperTrail's moat rules and
mirrors the TypeScript contract in `lib/contradiction/atlas.ts`.

**No other file in this engine is modified.** `papertrail_conflict.py` is standalone,
stdlib-only Python (no Valsci install, no network, no model download), and this whole
directory is excluded from the Next build — so there is zero TypeScript/build impact.

---

## Why it exists

Upstream Valsci runs: gather papers → per-paper `analyze_relevance_and_extract`
(`processor.py`; relevance 0..1 + verbatim excerpts, papers with `relevance >= 0.1` kept,
`processor.py:1076`) → an **LLM** in `prompts/final_report_system.txt` synthesizes the
excerpts into a single ordinal `claimRating`:

> Contradicted / Likely False / Mixed Evidence / Likely True / Highly Supported / No Evidence

When that rating is **Mixed Evidence**, Valsci stops at *"the evidence conflicts."* It does
**not** explain **why** the two sides disagree — which is exactly the question the
Quantitative Contradiction Atlas answers.

PaperTrail's **moat rule** is: *no LLM in the verdict / numeric / attribution path.* So this
file ports the contradiction-resolution loop Valsci implies but never makes deterministic.
Given the per-paper **signed supports** + grounded design features already produced upstream
(by the TS `lib/scieval/valsci` port + the atlas feature tagger), it deterministically emits
the `{resolution_category, primary_hypothesis, supporting_count}` shape the roadmap names.

| Valsci step | `papertrail_conflict.py` |
| --- | --- |
| relevance gate `relevance >= 0.1` (`processor.py:1076`) | `RELEVANCE_FLOOR = 0.1` — sources below the floor drop before joining a side |
| per-paper excerpt + rating (LLM in `final_report`) | consumes the **already-grounded** signed support + design features; **no LLM** here |
| single ordinal `claimRating` (LLM picks) | deterministic partition by `sign(support)` → supporting vs refuting sides |
| *(missing)* why the sides disagree | `score_dimension()` + `resolve()` attribute the reversal to a design dimension by rule |

---

## What it computes (all deterministic)

1. **Side partition** — `_side_for_support`: `support > 0` → supporting, `< 0` → refuting,
   `0` → excluded. Identical to `sideForSupport` in `lib/contradiction/atlas.ts`.
2. **Per-dimension attribution** — `score_dimension` for each of
   `population / dose / tissue / follow_up`: a dimension **differs** only when BOTH sides
   report it AND their value sets are disjoint (case-insensitive). Strength =
   `COVERAGE_WEIGHT * coverage + BELIEF_WEIGHT * mean_side_belief` (weights `0.7 / 0.3`).
3. **Resolution** — `resolve`: the highest-strength differing dimension above
   `MIN_ATTRIBUTION_STRENGTH = 0.35` becomes `attributed_reversal` with a
   `primary_hypothesis`; both sides present but nothing clears the floor →
   `unattributed_conflict`; one side empty → `no_conflict`; too few → `insufficient`.

Every constant is FIXED and **identical** to `lib/contradiction/atlas.ts`, so the Python
engine is an exact by-hand cross-check of the TS hot path (roadmap risk #4: *prefer native TS
on hot paths with the Python engine as cross-check*).

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network. Same input → same output, always.
- **Groundable** — every `quote` it consumes is already a verbatim substring of its source
  (grounded upstream by `lib/grounding.ts` `locateSpan`); this file never invents a quote.
- **Honest abstention** — it returns `unattributed_conflict` rather than force-fitting a
  reversal onto a dimension, mirroring PaperTrail's "honest insufficient over a forced
  answer" rule.
- **No LLM in the verdict** — the resolution category, the winning dimension, and every
  number are decided by rule; Claude only tags candidate dimensions upstream.

---

## How to run

```bash
python papertrail_conflict.py --json '{
  "claim": "Drug X reduces thrombosis",
  "sources": [
    {"source_type":"pubmed","external_id":"1","support":0.8,"relevance":0.9,
     "features":[{"dimension":"population","value":"elderly","quote":"elderly patients"}]},
    {"source_type":"pubmed","external_id":"2","support":-0.7,"relevance":0.8,
     "features":[{"dimension":"population","value":"young adults","quote":"young adults"}]}
  ]
}'
```

Prints one JSON object mirroring `ContradictionAtlasResult` (`resolution_category`,
`primary_hypothesis`, `supporting_count`, `refuting_count`, `attributions`, …).
