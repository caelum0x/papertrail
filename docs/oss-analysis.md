# OSS Alternatives & Adopted Libraries

_From a multi-agent research workflow (competitors · libraries · datasets)._

## Positioning vs OSS claim verifiers

Open-source claim verifiers — **Valsci** (biomedical, RAG + LLM over abstracts), **Loki /
OpenFactVerification**, **MiniCheck**, the **SciFact / MultiVerS / VeriSci** lineage, and
2025–26 registry-native efforts (CT Open, ClinicalTrialsHub, MedRAGChecker) — stop at
**textual entailment or LLM judgment** over prose, abstracts, or a knowledge graph. They
assess whether the literature *agrees* with a claim.

**PaperTrail puts no LLM in the numeric loop.** It recomputes ARR / NNT / risk ratio + 95%
CI directly from ClinicalTrials.gov's registered per-arm event counts, checks the claim
against the trial's registered primary analysis, and flags primary-vs-secondary endpoint
switching. It doesn't check whether sources *agree* with the number — it independently
recomputes the number the trial actually registered, and shows its work.

## Libraries adopted (MIT/Apache, merged directly)

| Library | License | Where | Why |
|---|---|---|---|
| **unpdf** | MIT | `lib/ingestion/pdfExtract.ts` | In-process (pdf.js) per-page PDF text extraction — no HTTP service. Proven on a real 9-page paper. |
| **Docling** | MIT | `python/document_ai/` + `lib/ingestion/docling.ts` | Structured scholarly-PDF extraction (sections/tables/reading order); merged as polyglot source, called by direct subprocess (opt-in `DOCLING_ENABLED`), falls back to unpdf. |
| **fast-xml-parser** | MIT | `lib/sources/pubmed.ts` | Replaces the regex PubMed XML parser; walks the real document structure, protecting the exact-span grounding invariant from entity/nested-tag corruption. |
| **simple-statistics** | ISC | `lib/biostats.ts` | Normal quantile (`probit`) for CI computation — no magic `1.96`. |

## Biostatistics: hand-rolled, oracle-locked

No maintained JS/TS package provides epidemiology-grade 2×2 confidence intervals, so the
log-RR (Katz) method is implemented in `lib/biostats.ts` and **locked to epitools/OpenEpi
reference values** in `tests/biostatsOracle.test.ts` (e.g. 15/100 vs 30/100 → RR 0.50, 95%
CI 0.29–0.87). "We wrote the math" becomes "our math equals the standard tools'."

## Datasets for evaluation

- **CliniFact** (`ds4dh/CliniFact`) — the only public benchmark derived from
  ClinicalTrials.gov structured results (~1,970 instances / 992 trials). Wired as an external
  eval corpus (collapse our taxonomy to binary; report precision/recall/F1). Validates the
  classifier/linking accuracy — not the numeric loop, which no public dataset labels (that
  gap *is* the differentiator).
- **HealthFC** (secondary) — stress-tests the honest `no_support_found` convention.

## Deferred

An optional local NLI signal (e.g. DeBERTa-NLI via `@huggingface/transformers`) for the
abstract-only path — corroborates claim *direction* only, strictly out of the numeric loop.
