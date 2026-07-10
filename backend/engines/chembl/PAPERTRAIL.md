# PaperTrail-native ingest bridge: ChEMBL (EMBL-EBI)

`run.py` in this directory is a **PaperTrail-native ingest engine**. We own this stack.
It is **not** one of the 17 vendored OSS engines, and no OSS engine is touched by it. It
pulls drug-like molecule records and their mechanisms of action into the shared `sources`
cache so PaperTrail can verify drug-target / clinical-phase claims against a primary
source.

It is standalone, **stdlib-only** Python (`urllib` / `json` / `hashlib` / `re` /
`argparse`) — no install, no third-party deps — and this whole `backend/engines/` tree is
excluded from the Next build, so there is zero TypeScript/build impact.

## What it does

Fetches from the public **ChEMBL REST API** (`https://www.ebi.ac.uk/chembl/api/data`):

1. `molecule` search by `pref_name__icontains` (or a **direct** `molecule/<CHEMBL_ID>`
   lookup when an entity CURIE / bare id resolves to a ChEMBL id — deterministic, single
   molecule, no name-search ambiguity).
2. `mechanism` rows per molecule (mechanism of action, action type, target ChEMBL id).

Each molecule is normalized into one cacheable **source record**. Max clinical phase is
copied verbatim from ChEMBL.

## Invocation

```bash
# Bare molecule name on stdin
echo "vemurafenib" | python3 run.py

# JSON on stdin (or via --arg) — direct CURIE lookup wins over a name search
python3 run.py --arg '{"entity":{"curie":"CHEMBL1229517","type":"chemical"},"limit":25}'
python3 run.py --arg '{"query":"vemurafenib","limit":10}'
```

Input is read from `--arg` **or** stdin. It accepts a JSON object
(`{query?, entity?:{surface?,curie?,type?}, sources?, limit?}`) or a bare molecule name.
A ChEMBL id in `entity.curie` (or a bare-id `query`, forms `CHEMBL123` /
`chembl:CHEMBL123`) triggers a deterministic single-molecule lookup. Otherwise the name
falls back to `entity.surface`. The query is read from stdin/args and **never** echoed —
only ids/counts hit stderr.

## Output shape (stdout, single JSON object)

```json
{
  "records": [
    {
      "external_id": "chembl:CHEMBL1229517",
      "title": "ChEMBL: VEMURAFENIB (CHEMBL1229517)",
      "raw_text": "ChEMBL molecule record for VEMURAFENIB ...",
      "url": "https://www.ebi.ac.uk/chembl/explore/compound/CHEMBL1229517",
      "metadata": {
        "engine": "chembl",
        "molecule_chembl_id": "CHEMBL1229517",
        "pref_name": "VEMURAFENIB",
        "molecule_type": "Small molecule",
        "max_phase": 4,
        "mechanisms": [
          {
            "mechanism_of_action": "Serine/threonine-protein kinase B-raf inhibitor",
            "action_type": "INHIBITOR",
            "target_chembl_id": "CHEMBL5145"
          }
        ]
      },
      "license": "Data from ChEMBL (EMBL-EBI), CC BY-SA 3.0.",
      "snapshot_id": "sha256:<64-hex>"
    }
  ]
}
```

- `external_id` — `chembl:` + the stable ChEMBL id (the natural cache key).
- `snapshot_id` — `sha256:` over `source_type \0 external_id \0 raw_text`.
- `raw_text` — template-stable and **offset-preserving** for exact span grounding.
- `max_phase` — the highest phase reached by **any** indication for the molecule in ChEMBL
  (not approval for a specific indication); the `raw_text` states this caveat so a verifier
  cannot overstate approval.

## How `lib/ingest/drivers/*.ts` consume it

The ChEMBL driver spawns `python3 backend/engines/chembl/run.py`, writes the ingest input
to **stdin**, reads the single JSON object from stdout, validates `records[]`, and maps
each record onto the cacheable `sources` row shape used by
`lib/ingest/searchAndCache.ts`:

| record field   | `sources` usage                                            |
| -------------- | ---------------------------------------------------------- |
| `external_id`  | `external_id` (cache key with `source_type='chembl'`)      |
| `title`        | `title`                                                    |
| `raw_text`     | `raw_text` (embedded + span-grounded)                      |
| `url`          | `url`                                                      |
| `metadata`     | per-source provenance / structured fields for the verifier |
| `license`      | ChEMBL CC BY-SA 3.0 attribution surfaced on results        |
| `snapshot_id`  | content-hash snapshot for cache-once dedupe                |

**Cache-once (moat rule):** the driver checks the `sources` cache by
`(source_type, external_id)` (and/or `snapshot_id`) before embedding/inserting — the demo
never depends on live EBI latency and a cached ChEMBL id is served without a re-fetch.

**Entity canonicalization (ingest-time):** after caching, the driver passes `sources.id` +
`raw_text` to `lib/ingest/entityCanonicalization.ts` (`canonicalizeSourceEntities`), which
runs NER (`lib/entities/ner.ts`, Claude only for NER) → deterministic `resolveMany`
(`lib/entities/canonicalize.ts`) → persists canonical CURIEs to `document_entities`. This
engine does no entity linking of its own.

## Determinism & honesty

- `max_phase`, molecule type, and mechanism strings are copied **verbatim** from ChEMBL —
  no LLM in the numeric/verdict path.
- On any HTTP/parse failure (or a 404) the engine returns `{"records": []}` — an honest
  empty rather than a fabricated bioactivity/phase.
- ChEMBL is CC BY-SA 3.0: the `license` field carries the required attribution so
  downstream consumers see and honor it.
