# PaperTrail specialization of scispaCy

`papertrail_linker.py` in this directory is a **PaperTrail-native specialization** of the
scispaCy engine. This repo owns the vendored scispaCy tree; rather than fork or fight the
upstream pipeline, we added one file that re-implements the *deterministic tail* of
scispaCy's pipeline in a way that satisfies PaperTrail's moat rules and mirrors the
TypeScript contracts the rest of the app already relies on.

**No other file in this engine is modified.** `papertrail_linker.py` is standalone,
stdlib-only Python (no scispaCy install, no model download, no network), and this whole
directory is excluded from the Next build — so there is zero TypeScript/build impact.

---

## Why it exists

Upstream scispaCy runs: trained NER model → `AbbreviationDetector`
(`scispacy/abbreviation.py`, Schwartz & Hearst 2003) → `EntityLinker`
(`scispacy/linking.py`) over a `KnowledgeBase` (`scispacy/linking_utils.py`) whose two
views are `alias_to_cuis` and `cui_to_entity`. A mention links only when a candidate
clears a similarity threshold, else it is left unlinked.

PaperTrail's **moat rule** is: *no LLM in entity linking or in the verdict/numeric path.*
Claude is used only for NER (`lib/entities/ner.ts`) and optional prose. So this file keeps
scispaCy's exact architecture for the deterministic steps and drops the model:

| scispaCy step | `papertrail_linker.py` |
| --- | --- |
| trained NER model | Claude NER upstream (`lib/entities/ner.ts`) via `--mentions`, **or** a deterministic in-KB alias finder when run standalone |
| `AbbreviationDetector` (Schwartz-Hearst) | `find_abbreviations()` — native port of `abbreviation.py` (`find_abbreviation`, `short_form_filter`, `filter_matches`) |
| `KnowledgeBase` (`alias_to_cuis` / `cui_to_entity`) | `_build_index()` → `_KbIndex` per ontology group, from an in-code `OntologyConcept` dictionary (real HGNC/UniProt/ChEMBL/EFO/DOID/GO ids) |
| `EntityLinker` (threshold link) | `_link_in_group()` + `_resolve_across_ontologies()` — exact→fuzzy, `LINK_THRESHOLD = 0.7`, honest unlinked below threshold |

It specializes the KB toward the six ontologies PaperTrail canonicalizes against:
**HGNC / UniProt** (genes & proteins), **ChEMBL** (chemicals/drugs), **EFO / DOID**
(diseases), and **GO** (biological processes / cellular components). Each mention is
resolved against all six **in parallel** (thread pool); the best-scoring, type-consistent
candidate wins with a deterministic tie-break.

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network. Same input → same output, always.
- **Offset-preserving** — every emitted mention carries the exact `[start, end)` character
  offsets of its **verbatim** substring in the input. A mention whose offsets/text can't be
  located verbatim is **dropped** (`grounding_dropped_count`), never asserted. This mirrors
  `locateSpan` and the "drop ungroundable" rule in `lib/grounding.ts`, so every linked
  span stays groundable to the source.
- **Abbreviation-aware** — a short-form mention (e.g. `AD`) links via its long form
  (`Alzheimer's disease`) when the text defines it as `long form (SHORT)`; the emitted
  offsets still point at the short form, and `abbreviation_of` records the expansion.
- **Provenance on every link** — `ontology` + `match_type` (`exact` | `abbrev` | `fuzzy`)
  + `score`, plus cross-references (`xrefs`) into DrugBank/Ensembl/MONDO/etc.
- **Honest miss** — no candidate clears the threshold → the mention is emitted **unlinked**
  (`curie: null`, `score: 0.0`) rather than force-fit to a wrong concept.

---

## How it maps to `lib/entities/canonicalize.ts`

`lib/entities/canonicalize.ts` defines the TypeScript canonicalizer contract:

```ts
interface CanonicalEntity { curie; canonicalLabel; ontology; termType; score; xrefs }
async function resolveEntity(pool, surface, type?): Promise<CanonicalEntity | null>
```

`papertrail_linker.py` is the **Python mirror** of that contract, one level richer (it
also does mention-finding, grounding, and abbreviation resolution). Field-for-field:

| `CanonicalEntity` (TS) | linker mention field (JSON) |
| --- | --- |
| `curie` | `curie` |
| `canonicalLabel` | `canonical_label` |
| `ontology` | `ontology` |
| `termType` | `type` |
| `score` | `score` |
| `xrefs` | `xrefs` |

Resolution semantics match `resolveEntity`: **normalize** the surface (lowercase, collapse
whitespace) → **exact** match against synonyms ⇒ score `1.0`; if a `type` is given, filter
by `term_type`; **return unlinked (≈ `null`)** when nothing clears the bar. The optional
`type` argument maps to the `--mentions[].type` field; omit it to resolve against all
ontologies. In production the TypeScript `resolveEntity` reads the `ontology_terms` /
`ontology_synonyms` / `ontology_xrefs` tables (migration `0062_bio-ontology.sql`); this
standalone file carries the same shape in-code so it runs with zero infrastructure — the
in-code `OntologyConcept` rows are the same rows you would seed those tables with.

It also mirrors `lib/entities/ner.ts` exactly: `_normalize` ↔ `normalizeAlias`,
`_overlap_score` ↔ `overlapScore`, `LINK_THRESHOLD = 0.7`, `find_abbreviations` ↔
`findAbbreviations`, and the ground-then-link-then-dedupe pipeline.

---

## How to invoke

Standalone, stdlib only (no install):

```bash
# 1. Text on stdin — built-in deterministic alias finder supplies candidates.
echo "Patients with Alzheimer's disease (AD) on aspirin; BRAF sequenced." \
  | python3 papertrail_linker.py

# 2. Text via flag.
python3 papertrail_linker.py --text "Vemurafenib inhibits BRAF in melanoma."

# 3. Link PRE-EXTRACTED mentions (e.g. the Claude NER output from lib/entities/ner.ts).
#    Offsets are respected; pass -1/-1 to have the linker locate the span verbatim.
python3 papertrail_linker.py \
  --text "The type 2 diabetes cohort received metformin." \
  --mentions '[{"text":"type 2 diabetes","start":4,"end":19,"type":"disease"},
               {"text":"metformin","start":36,"end":45,"type":"chemical"}]'

# 4. Tune parallelism (default 6 workers, one per ontology group).
python3 papertrail_linker.py --workers 6 --text "..."
```

### Output shape

```json
{
  "mentions": [
    {
      "text": "AD", "start": 35, "end": 37, "type": "disease",
      "curie": "EFO:0000249", "ontology": "EFO",
      "match_type": "abbrev", "score": 1.0,
      "canonical_label": "Alzheimer's disease",
      "abbreviation_of": "Alzheimer's disease",
      "xrefs": ["DOID:10652", "MONDO:0004975"]
    }
  ],
  "grounding_dropped_count": 0,
  "linked_count": 1,
  "abbreviations": { "ad": "Alzheimer's disease" }
}
```

- Valid `type` values: `gene`, `disease`, `chemical`, `variant`, `biological_process`,
  `cellular_component`. An unknown/omitted type resolves against **all** ontologies.
- `match_type`: `exact` (normalized alias hit), `abbrev` (linked via a Schwartz-Hearst
  long form), `fuzzy` (token-overlap ≥ 0.7), or `null` when unlinked.
- Invalid `--mentions` JSON is reported as `{"error": ...}` on stdout with exit code `2`
  (honest boundary failure, never a silent crash).

### Extending the KB

The linker is data-driven: add an `OntologyConcept(...)` row to the relevant tuple
(`_GENE_CONCEPTS`, `_CHEMICAL_CONCEPTS`, `_DISEASE_CONCEPTS`, `_GO_CONCEPTS`) — no code
change. Keep CURIEs real (auditable against public terminologies) and keep the row in sync
with what you seed into the `ontology_terms` family of tables in
`0062_bio-ontology.sql`.
