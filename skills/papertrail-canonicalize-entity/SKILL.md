---
name: papertrail-canonicalize-entity
description: Resolve a biomedical surface form (a gene symbol, disease name, cell type, or synonym) to its canonical ontology CURIE, label, and cross-references via a deterministic synonym match — returning null on an honest miss. Use when a scientist needs the exact ontology id / xrefs for an entity, or wants to normalize a free-text term before querying an evidence engine.
---

# PaperTrail: Canonicalize Entity

Resolve a free-text biomedical surface form to its canonical ontology term:
CURIE, canonical label, ontology, term type, and cross-references. The match is a
deterministic exact-synonym lookup (normalized surface → curated
`ontology_synonyms`) — no LLM guesses an id, and an unrecognized surface returns
an honest `null` rather than a fabricated CURIE.

## Hard guarantees (state these to the user)

- **Deterministic resolution** — the surface is normalized (lowercase, collapsed
  whitespace) and matched exactly against curated synonyms; same surface, same
  CURIE, score 1.0. No LLM is in the linking path.
- **Grounded in the ontology** — the returned CURIE, label, and xrefs come from
  curated ontology tables, not model recall.
- **Honest miss** — when nothing matches, the result is `null` (no canonical
  term), never a plausible-looking but invented id.

## Step 1 — Call the tool

Preferred: the **`canonicalize_entity`** MCP tool (PaperTrail connector).

Inputs:
- `surface` (string, required) — the term to resolve, e.g. `"HER2"` or
  `"heart attack"`.
- `type` (string, optional) — a term-type filter (e.g. a gene / disease /
  cell-type type) to disambiguate the match.

Pass `type` when the surface is ambiguous across ontologies to constrain the
resolution.

## Step 2 — Read the result

Report the resolved **CURIE**, **canonical label**, **ontology**, **term type**,
the **score**, and the **xrefs** (cross-references to other ontologies). If the
result is `null`, say the surface did not resolve to a canonical term — do not
substitute your own id.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. No API key required.

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/entities/canonicalize \
  -H 'Content-Type: application/json' \
  -d '{ "surface": "HER2", "type": "gene" }'
```

Returns the standard `{ success, data, error }` envelope; the canonical entity
(or `null`) lives under `data`.

## Notes

- Normalize once here, then reuse the CURIE across the evidence engines for a
  consistent identity.
- A `null` result means the surface is not in the curated synonym set — not that
  the entity does not exist. State this distinction.
