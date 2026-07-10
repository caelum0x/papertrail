---
name: papertrail-target-disease
description: Assess whether a gene/protein target is linked to a disease using Open Targets association scores and GWAS/ClinVar genetic evidence. Use when a scientist asks "is target X a good target for disease Y?" or wants the genetic association evidence behind a target-disease hypothesis.
---

# PaperTrail: Target-Disease Evidence

Two complementary, deterministic lookups for a target-disease hypothesis:
the Open Targets **association** view (aggregated evidence types) and the
**genetic association** view (GWAS Catalog + ClinVar).

## Hard guarantees (state these to the user)

- **Deterministic recompute** — association scores and genetic verdicts come
  from fixed queries against Open Targets, the EBI GWAS Catalog, and NCBI
  ClinVar. Same target-disease pair, same evidence, same verdict.
- **Grounded in registries** — every score/verdict resolves to real gene ids
  (Ensembl), disease ids (EFO), and catalog records; nothing is model-invented.
- **Honest absence** — if Open Targets reports no evidence of a given type, that
  datatype score is null (not zero-imputed); if no genetic association exists,
  the verdict says so.

## Step 1 — Target-disease association (`bio_target_disease`)

Call the **`bio_target_disease`** MCP tool.

Inputs:
- `target` (string, required) — gene/protein symbol, e.g. `"PCSK9"`.
- `disease` (string, required) — e.g. `"hypercholesterolemia"`.

Report the overall association score, the per-datatype breakdown (genetic
association, known drugs, expression, pathways, animal models, etc.), and any
known drugs already acting on the target for that disease.

## Step 2 — Genetic association (`bio_genetic_association`)

For the human-genetics evidence specifically, call the
**`bio_genetic_association`** MCP tool.

Inputs:
- `disease` (string, required, 2–200 chars) — the disease/trait.
- **At least one** locus key: `gene` (symbol) and/or `variant` (rsID).

Report the GWAS Catalog hits (trait, p-value, risk allele) and ClinVar
clinical significance, with a deterministic verdict on whether the association
is supported.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. No API key required.

Target-disease association:

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/bio/target-disease \
  -H 'Content-Type: application/json' \
  -d '{ "target": "PCSK9", "disease": "hypercholesterolemia" }'
```

Genetic association:

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/bio/genetic-association \
  -H 'Content-Type: application/json' \
  -d '{ "gene": "PCSK9", "variant": "rs11591147", "disease": "hypercholesterolemia" }'
```

Both return the standard `{ success, data, error }` envelope.

## Notes

- Provide the standard HGNC gene symbol for the cleanest Ensembl resolution.
- A high association score reflects aggregated evidence, not a guarantee of
  clinical tractability — pair with drug/mechanism tools when needed.
