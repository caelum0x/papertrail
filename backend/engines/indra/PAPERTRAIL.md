# PaperTrail specialization of INDRA

`grounding_hook.py` in this directory is a **PaperTrail-native specialization** of the INDRA
engine. This repo owns the vendored INDRA tree; rather than fork the assembly pipeline, we
added one file that surfaces two INDRA signals — **RefContext** (tissue / species / assay)
and the deterministic **belief** score — into the Quantitative Contradiction Atlas, mirroring
the TypeScript contract in `lib/contradiction/atlas.ts` + `lib/mechanism/assemble.ts`.

**No other file in this engine is modified.** `grounding_hook.py` is standalone Python
(stdlib only, plus INDRA's own belief-prior JSON when present — with a documented fallback so
it runs with no INDRA install and no network). This whole directory is excluded from the Next
build, so there is zero TypeScript/build impact.

---

## Why it exists

INDRA attaches a `BioContext` (`indra/statements/context.py`) to every Statement's Evidence,
built from `RefContext` slots: `location / cell_line / cell_type / organ / disease / species`.
And INDRA computes a per-Statement `belief` (`indra/belief/__init__.py`, `SimpleScorer`):

> probability CORRECT = `1 - prod_i (1 - reliability_i)` over the evidence sources

Both signals normally live **inside** INDRA's assembly and are never surfaced to a downstream
contradiction explainer. But the Contradiction Atlas needs exactly them: the **tissue /
species** a mechanism was observed in maps onto the atlas's `tissue` / `population` design
dimensions (a reversal is often *"different cell type / different species"*), and the
**belief** weights how much a side's mechanism should count.

So this hook does two deterministic things, with **no LLM**:

| INDRA internal | `grounding_hook.py` surfaces it as |
| --- | --- |
| `BioContext` RefContext slots (`context.py` `BioContext.attrs`) | atlas design features: `cell_type/cell_line/organ/location → tissue`, `species/disease → population` (`CONTEXT_SLOT_TO_DIMENSION`) |
| `RefContext.db_refs` grounding | each feature carries its `db_refs` (e.g. `{"TAXONOMY":"9606"}`) for audit |
| `SimpleScorer` belief `1 - prod(1 - r_i)` (`belief/__init__.py`) | `combine_belief()` re-derives it from the evidence `source_api` list |
| `default_belief_probs.json` (`indra/resources/`) | per-source reliability `r_i = 1 - syst - rand` loaded from that exact file (documented fallback if absent) |

`follow_up` and `dose` have no RefContext analogue in INDRA and are contributed by the
trial-design tagger instead — this hook only surfaces what INDRA actually grounds.

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network. Same input → same output, always.
- **Belief by rule** — belief is re-derived from the source list via INDRA's own priors;
  **no LLM number is load-bearing**, mirroring `combineBelief()` in
  `lib/mechanism/assemble.ts`.
- **Drop the ungrounded** — a RefContext slot with no grounded name is dropped (never assert
  an ungrounded context), matching PaperTrail's `locateSpan` "drop the ungroundable" rule.
- **Honest empty** — a statement with no context yields no features; with no evidence,
  belief `0.0`.

---

## How to run

```bash
python grounding_hook.py --json '{
  "statements": [
    {"type":"Activation","evidence":[
      {"source_api":"reach","context":{
        "cell_type":{"name":"hepatocytes","db_refs":{"CL":"0000182"}},
        "species":{"name":"Homo sapiens","db_refs":{"TAXONOMY":"9606"}}}},
      {"source_api":"signor","context":{"organ":"liver"}}
    ]}
  ]
}'
```

Prints one JSON object: `{ "statements": [ { "belief": float,
"features": [ { "dimension", "value", "quote", "db_refs", "indra_slot" } ] } ] }` — the
belief + grounded tissue/population features the atlas consumes as `mechanism_belief` and
per-side design features.
