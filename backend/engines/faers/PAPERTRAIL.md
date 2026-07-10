# PaperTrail-native ingest bridge: OpenFDA FAERS

`run.py` in this directory is a **PaperTrail-native ingest engine**. We own this stack.
It is **not** one of the 17 vendored OSS engines, and no OSS engine is touched by it. It
turns PaperTrail's multi-source ingest from a literature-only cache into an **evidence
integrator** by pulling FDA adverse-event signal data into the shared `sources` cache.

It is standalone, **stdlib-only** Python (`urllib` / `json` / `hashlib` / `argparse`) —
no install, no third-party deps — and this whole `backend/engines/` tree is excluded from
the Next build, so there is zero TypeScript/build impact.

## What it does

Fetches from the public **OpenFDA FAERS** API (`https://api.fda.gov/drug/event.json`):

1. For a drug query, a `count`-by-reaction aggregation over the FAERS report corpus.
2. The drug's total report count (denominator context).

Each `(drug, reaction)` signal is normalized into one cacheable **source record**.

## Invocation

```bash
# Bare query on stdin
echo "atorvastatin" | python3 run.py

# JSON on stdin (or via --arg) with an entity + limit
python3 run.py --arg '{"query":"atorvastatin","entity":{"surface":"atorvastatin","type":"chemical"},"limit":25}'
```

Input is read from `--arg` **or** stdin. It accepts a JSON object
(`{query?, entity?:{surface?,curie?,type?}, sources?, limit?}`) or a bare query string.
When `query` is absent, the drug term falls back to `entity.surface`. The query is read
from stdin/args and **never** placed on argv-as-log or echoed — only ids/counts hit
stderr.

## Output shape (stdout, single JSON object)

```json
{
  "records": [
    {
      "external_id": "faers:<16-hex>",
      "title": "FAERS signal: <drug> — <reaction>",
      "raw_text": "FDA FAERS adverse-event reports: ...",
      "url": "https://api.fda.gov/drug/event.json?search=...",
      "metadata": {
        "engine": "faers",
        "drug": "...",
        "reaction": "...",
        "report_count": 42,
        "drug_total_reports": 10345,
        "count_field": "patient.reaction.reactionmeddrapt.exact"
      },
      "license": "OpenFDA / FDA FAERS — U.S. Government public domain.",
      "snapshot_id": "sha256:<64-hex>"
    }
  ]
}
```

- `external_id` — `faers:` + a 16-hex hash of the lowercased `drug|reaction` pair. Stable
  across fetch time and report ordering, so it is a reliable **cache key**.
- `snapshot_id` — `sha256:` over `source_type \0 external_id \0 raw_text`. The same
  normalized content always yields the identical id.
- `raw_text` — template-stable and **offset-preserving**, so the TS driver can ground
  flagged spans to exact substrings.

## How `lib/ingest/drivers/*.ts` consume it

The FAERS driver spawns `python3 backend/engines/faers/run.py`, writes the ingest input to
**stdin** (never argv), reads the single JSON object from stdout, and validates the
`records[]` shape (e.g. via a Zod schema). For each record it maps onto the cacheable
`sources` row shape used by `lib/ingest/searchAndCache.ts`:

| record field   | `sources` usage                                                    |
| -------------- | ------------------------------------------------------------------ |
| `external_id`  | `external_id` (cache key with `source_type='faers'`)               |
| `title`        | `title`                                                            |
| `raw_text`     | `raw_text` (embedded + span-grounded)                              |
| `url`          | `url`                                                              |
| `metadata`     | per-source provenance / structured fields for the verifier         |
| `license`      | provenance surfaced on results                                     |
| `snapshot_id`  | content-hash snapshot for cache-once dedupe                        |

**Cache-once (moat rule):** the driver first checks the `sources` cache by
`(source_type, external_id)` (and/or `snapshot_id`) and only embeds/inserts genuinely new
rows — the demo never depends on live OpenFDA latency, and a cached row is always served
without a re-fetch.

**Entity canonicalization (ingest-time):** after a row is cached, the driver hands the
`sources.id` + `raw_text` to `lib/ingest/entityCanonicalization.ts`
(`canonicalizeSourceEntities`), which runs NER (`lib/entities/ner.ts`, Claude only for
NER) → deterministic `resolveMany` (`lib/entities/canonicalize.ts`) → persists canonical
CURIEs to `document_entities`. This engine deliberately does **no** entity linking of its
own; that is the deterministic Phase-1 canonicalizer's job.

## Determinism & honesty

- Counts are copied **verbatim** from OpenFDA — no LLM, no rounding, no inference.
- On any HTTP/parse failure (or a 404 = "no matching reports") the engine returns
  `{"records": []}` — an honest empty rather than a fabricated signal.
- FAERS spontaneous reports are a hypothesis-generating signal, not proof of causation;
  the `raw_text` says so explicitly so a downstream verifier cannot overstate it.
