# PaperTrail-native ingest bridge: NCBI ClinVar

`run.py` in this directory is a **PaperTrail-native ingest engine**. We own this stack.
It is **not** one of the 17 vendored OSS engines, and no OSS engine is touched by it. It
pulls variant clinical-significance interpretations into the shared `sources` cache so
PaperTrail can verify genetic-pathogenicity claims against a primary source.

It is standalone, **stdlib-only** Python (`urllib` / `json` / `hashlib` / `argparse`) —
no install, no third-party deps — and this whole `backend/engines/` tree is excluded from
the Next build, so there is zero TypeScript/build impact.

## What it does

Fetches from the public **NCBI E-utilities** over the `clinvar` database:

1. `esearch.fcgi` → resolve ClinVar **VariationID**s for a search term.
2. `esummary.fcgi` (JSON retmode) → the docsum for each id: germline classification
   (clinical significance), review status, genes, and conditions.

Each variant is normalized into one cacheable **source record**. ClinVar's documented
**review-status → gold-star** scale is reproduced verbatim (mirrors
`lib/bio/variantPathogenicity.ts`) — never inferred.

## Invocation

```bash
# Bare term on stdin
echo "BRCA1 pathogenic" | python3 run.py

# JSON on stdin (or via --arg) with an entity + limit
python3 run.py --arg '{"query":"BRCA1 pathogenic","entity":{"surface":"rs80357906","type":"variant"},"limit":25}'
```

Input is read from `--arg` **or** stdin. It accepts a JSON object
(`{query?, entity?:{surface?,curie?,type?}, sources?, limit?}`) or a bare search term.
When `query` is absent, the term falls back to `entity.surface`. Optional `NCBI_API_KEY`
/ `NCBI_EMAIL` env vars are passed through for higher E-utilities rate limits. The query
is read from stdin/args and **never** echoed — only ids/counts hit stderr.

## Output shape (stdout, single JSON object)

```json
{
  "records": [
    {
      "external_id": "clinvar:<VariationID>",
      "title": "ClinVar: <variant title>",
      "raw_text": "NCBI ClinVar interpretation for ...",
      "url": "https://www.ncbi.nlm.nih.gov/clinvar/variation/<id>/",
      "metadata": {
        "engine": "clinvar",
        "variation_id": "12345",
        "clinical_significance": "Pathogenic",
        "review_status": "criteria provided, multiple submitters, no conflicts",
        "review_stars": 2,
        "genes": ["BRCA1"],
        "conditions": ["Hereditary breast ovarian cancer syndrome"],
        "accession": "VCV000012345"
      },
      "license": "NCBI ClinVar — public domain (NLM / NCBI).",
      "snapshot_id": "sha256:<64-hex>"
    }
  ]
}
```

- `external_id` — `clinvar:` + the stable ClinVar **VariationID** (the natural cache key).
- `snapshot_id` — `sha256:` over `source_type \0 external_id \0 raw_text`.
- `raw_text` — template-stable and **offset-preserving** for exact span grounding.
- `review_stars` — from the documented ClinVar review-confidence scale; below one star an
  assertion lacks documented ACMG criteria, and the `raw_text` says so.

## How `lib/ingest/drivers/*.ts` consume it

The ClinVar driver spawns `python3 backend/engines/clinvar/run.py`, writes the ingest
input to **stdin**, reads the single JSON object from stdout, validates `records[]`, and
maps each record onto the cacheable `sources` row shape used by
`lib/ingest/searchAndCache.ts`:

| record field   | `sources` usage                                             |
| -------------- | ----------------------------------------------------------- |
| `external_id`  | `external_id` (cache key with `source_type='clinvar'`)      |
| `title`        | `title`                                                     |
| `raw_text`     | `raw_text` (embedded + span-grounded)                       |
| `url`          | `url`                                                       |
| `metadata`     | per-source provenance / structured fields for the verifier  |
| `license`      | provenance surfaced on results                              |
| `snapshot_id`  | content-hash snapshot for cache-once dedupe                 |

**Cache-once (moat rule):** the driver checks the `sources` cache by
`(source_type, external_id)` (and/or `snapshot_id`) before embedding/inserting — the demo
never depends on live NCBI latency and a cached VariationID is served without a re-fetch.

**Entity canonicalization (ingest-time):** after caching, the driver passes `sources.id` +
`raw_text` to `lib/ingest/entityCanonicalization.ts` (`canonicalizeSourceEntities`), which
runs NER (`lib/entities/ner.ts`, Claude only for NER) → deterministic `resolveMany`
(`lib/entities/canonicalize.ts`) → persists canonical CURIEs to `document_entities`. This
engine does no entity linking of its own.

## Determinism & honesty

- Clinical significance and review status are copied **verbatim** from esummary; the star
  rating is a fixed table lookup — no LLM in the numeric/verdict path.
- On any HTTP/parse failure (or no matching variants) the engine returns
  `{"records": []}` — an honest empty rather than a fabricated interpretation.
- esearch relevance order is preserved through to the emitted records.
