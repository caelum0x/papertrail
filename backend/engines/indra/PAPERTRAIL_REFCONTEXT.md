# PaperTrail specialization of INDRA — RefContext extractor

`papertrail_refcontext.py` in this directory is a **PaperTrail-native specialization** of
the INDRA engine. It is a second, self-contained specialization alongside
`grounding_hook.py` (documented in `PAPERTRAIL.md`); it does **not** modify any existing
INDRA file.

Where `grounding_hook.py` surfaces INDRA's belief + RefContext for the *Contradiction
Atlas*, this file specializes INDRA's **RefContext** for **context-aware mechanism
extraction** — the "de-risk preclinical→human translation" feature. It is the Python
mirror of the TypeScript classifiers in `lib/mechanism/context.ts` and the constant tables
in `lib/mechanism/schemas.ts`.

**Standalone Python (stdlib only)** — no INDRA install, no network. This whole directory is
excluded from the Next build, so there is zero TypeScript/build impact.

---

## Why it exists

INDRA attaches a `BioContext` (`indra/statements/context.py`) to every Statement's
Evidence, built from `RefContext` slots: `location / cell_line / cell_type / organ /
disease / species`. Those slots normally stay **inside** INDRA and are only ever normalized
to a tissue/species/assay bucket by ad-hoc downstream code.

PaperTrail's context-aware mechanism feature needs exactly that normalization: a mechanism
observed in **human in-vivo** extrapolates far better to the clinic than one seen in a
mouse or a dish. So this hook does two deterministic things, with **no LLM**:

| INDRA internal | `papertrail_refcontext.py` produces |
| --- | --- |
| `RefContext` slots `cell_type/cell_line/organ/location` | `tissue` (free-text UBERON-ish surface term) + grounded `tags` |
| `RefContext` `species` slot | normalized `species` bucket: `human / mouse / rat / in-vitro` (`classify_species`) |
| in-vitro-ish slot terms + species terms | normalized `assay` bucket: `in-vivo / in-vitro / cell-line` (`classify_assay`) |
| — (new deterministic score) | `translation_confidence` ∈ [0,1] = species-factor × assay-factor |
| `RefContext.db_refs` grounding | each `tag` carries its `db_refs` (e.g. `{"TAXONOMY":"9606"}`) for audit |

`translation_confidence` uses the same fixed tables as
`lib/mechanism/schemas.ts` (`SPECIES_CONFIDENCE` / `ASSAY_CONFIDENCE`):
human in-vivo `1.0`, animal in-vivo `0.6`, in-vitro `≈0.3×0.4`, unknown conservative.

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network. Same input → same output, always.
- **Rule-decided buckets** — species/assay are chosen by documented surface-term rules,
  never by a model; `translation_confidence` is pure table arithmetic. **No LLM number is
  load-bearing**, mirroring `translationConfidence()` in `lib/mechanism/context.ts`.
- **Drop the ungrounded** — a RefContext slot with no grounded name is dropped; an
  unresolved species/assay stays `null` (honest "unknown" over a forced bucket), matching
  PaperTrail's `locateSpan` "drop the ungroundable" rule.
- **Honest empty** — a context with no grounded slots yields `tissue/species/assay = null`
  and the conservative unknown×unknown translation score.

---

## How to run

```bash
python papertrail_refcontext.py --json '{
  "contexts": [
    { "cell_type": {"name":"hepatocytes","db_refs":{"CL":"0000182"}},
      "species":   {"name":"Homo sapiens","db_refs":{"TAXONOMY":"9606"}} },
    { "cell_line": "HEK293" }
  ]
}'
```

Prints one JSON object:
`{ "contexts": [ { "tissue", "species", "assay", "translation_confidence",
"tags": [ { "kind", "value", "db_refs" } ] } ] }` — the normalized context + deterministic
translation confidence that the TypeScript `lib/mechanism/context.ts` computes for the
`/api/mechanism/context-filter` route and the `mechanism-context` console.
