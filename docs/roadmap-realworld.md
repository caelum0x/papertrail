# PaperTrail — Real-World Product Roadmap

_Post-hackathon. Synthesized from a 6-cluster code-grounded analysis of the OSS engines +
product surface (`.claude/workflows/realworld-roadmap.js`). This is the blueprint for turning
the MVP into a fundable, defensible regulatory-grade evidence platform._

## Thesis

PaperTrail's moat is a combination **no comp (Causaly / Aetion / Open Targets) has assembled**:

1. **Deterministic biostatistics** — no LLM in the numeric loop (risk ratios, NNT, I², τ², GRADE).
2. **Exact-span grounding** — every assertion maps to a verbatim substring of cached source text.
3. **Honest downgrade** — anything ungroundable is dropped/flagged, never asserted.
4. **17 permissively-licensed OSS engines we OWN** and can specialize in place.

The company is not "one more feature" — it is a **regulatory-grade evidence platform**. The
winning sequence compounds the moat along one spine: **ground it** (multi-DB ingest + entity
canonicalization) → **verify it deeper** (cross-source contradiction, context-aware mechanism,
subgroup/publication-bias) → **codify it into an auditable regulatory deliverable** (PRISMA +
Summary-of-Findings + immutable provenance chain + submission bundles).

**Guardrail:** every new deliverable must ground to a span, decide by rule where numbers are
involved, and serialize provenance for audit. Breadth that adds ungrounded or LLM-in-the-loop
surfaces *erodes* the differentiator — reject it.

## Flagship wedge — the Precision-Medicine Claim Audit

One live demo that proves the moat end-to-end. Take a real claim — _"JAK2 V617F carriers on
Drug X show 30% reduced thrombosis"_ — and run the full grounded spine:

1. **Canonical entity resolution** links JAK2 V617F → UniProt variant ID, Drug X → ChEMBL ID at ingest.
2. **Multi-DB integration** pulls ClinVar pathogenicity, ChEMBL selectivity, FAERS safety signals + PubMed/CT.gov.
3. **Deterministic OUTCOME-MISMATCH rule** fires when the claimed outcome contradicts the registered ClinVar classification (no LLM).
4. **Biostatistics** reconciles the 30% against the trial's registered primary endpoint; flags subgroup-cited-as-primary + publication-bias GRADE downgrade.
5. **Contradiction Atlas** explains a conflicting source by population difference.
6. Every span, number, and source snapshot exports into an **immutable chain-of-custody PDF** + a PRISMA / Summary-of-Findings dossier a regulator can audit line-by-line.

> Pitch: _"Causaly/Aetion summarize evidence; PaperTrail proves it — every number rule-decidable,
> every claim grounded to an exact span, every source version hashed for FDA/EMA audit."_
> Exercises 8+ specialized engines in a single 3-minute demo.

## Now (foundation everything else needs)

- **Multi-database live ingest.** Wire the declared-but-inert 7 DBs into ingestion: add
  `backend/engines/faers/`, `backend/engines/clinvar/`, `backend/engines/chembl/` bridges;
  promote `lib/bio/{chembl,pharmacovigilance,variantPathogenicity,openTargets,pubtator}.ts` from
  query-only into ingest drivers via `lib/ingest/multiSourcePipeline.ts`. Extend `sources`
  (`variant_id`, `compound_id`, `adverse_event_cui`, `source_snapshot_id`) + `recordAccess()`.
- **Ingest-time entity canonicalization.** Wire `lib/entities/ner.ts` + biolink into
  `searchAndCache` → new `document_entities` table (HGNC / ChEMBL / UMLS CUI / DOID). Specialize
  `backend/engines/scispacy/papertrail_linker.py` (parallel multi-ontology, offset-preserving).
- **Contextual source re-ranking** (~40–60% noise cut). `lib/agents/contextualRank.ts` second
  pass after retrieval; specialize `backend/engines/OpenFactVerification/loki/papertrail_rerank.py`.
  Wire into `/api/verify` + `/api/factcheck`.
- **PRISMA + Summary-of-Findings dashboard.** Auto-generate PRISMA 2020 flow + SoF table from
  `sr_records` + `lib/metaAnalysis.ts` + `lib/grade.ts` + `lib/publicationBias.ts`; publication-
  ready DOCX (FDA/EMA/NICE). Pages `/console/evidence-synthesis/prisma-flow`, `/summary-of-findings`.

## Next

- **Live entity-linking + outcome-association validator** — variant → registered ClinVar/ClinGen
  association; deterministic OUTCOME-MISMATCH rule.
- **Quantitative Contradiction Atlas** — route `scieval` "mixed" verdicts to a deterministic
  conflict explainer (population/dose/tissue/follow-up) using INDRA belief + pytrials design.
  Specialize `backend/engines/Valsci/` + `backend/engines/indra/`.
- **Pharmacovigilance signal detection** — FAERS disproportionality (PRR/ROR/χ²), temporal
  clustering, dose-response via `lib/biostats.ts` + `lib/survival.ts`; `adverse_event_watch` monitor.
- **Subgroup + publication-bias verification hardening** — wire `lib/subgroupAnalysis.ts` into
  `lib/structuredVerification.ts`; `lib/publicationBias.ts` → auto GRADE downgrade.
- **Immutable provenance / audit chain + snapshot versioning** — every span carries
  `{source_id, doi/pmid, source_version, snapshot_date, verification_id, chain_of_custody_hash}`;
  `/api/audit-chain/verification/[id]` reconstructs exact state at export (21 CFR Part 11-grade).
- **Query expansion (RAG-Fusion) + evidence-sufficiency loop** — specialize `backend/engines/R2R/`
  for biomedical sub-query decomposition; iterative sufficiency gate before synthesis stops.

## Later

- Context-aware mechanism extraction (tissue/species/assay grounding; specialize `indra/RefContext`).
- Learned link prediction (nightly TransE/RotatE in `backend/engines/pykeen/`, ~30%→60–70% precision).
- Human-in-the-loop curation + inter-rater agreement (Cohen's/Fleiss' κ, Krippendorff's α).
- Living evidence + citation-velocity monitors (specialize `backend/engines/pyalex/`).
- IPD meta-analysis, effect-size harmonization, ARR/NNT, Bayesian posterior/predictive (`PyMARE`).
- Regulatory submission bundles (CTD/eCTD), RWE phenotyping workbench (OHDSI on `pytrials`),
  enterprise integrations, STORM multi-perspective evidence debate for mixed verdicts.

## By axis

### OSS-engine deepening (edit `backend/engines/<engine>/` in place)

| Engine | PaperTrail-native specialization |
|---|---|
| **scispaCy** | `papertrail_linker.py` — parallel HGNC/PubChem/EFO/GO/ChEMBL resolution, offset-preserving spans + provenance |
| **INDRA** | `papertrail/grounding_hook.py` — agent sense-check vs HGNC/PubChem/UniProt (kill hallucinated agents); surface RefContext + belief scores into verification |
| **Valsci** | `papertrail_conflict.py` — deterministic contradiction-resolution loop → `{resolution_category, primary_hypothesis, supporting_count}` |
| **Loki / OpenFactVerification** | `papertrail_rerank.py` — claim-frame on-topic re-ranker |
| **R2R** | biomedical sub-query decomposition + confidence-weighted KG-edge reranking |
| **PyMARE** | Egger/trim-and-fill + Bayesian posterior/predictive + IPD two-stage as reference checks |
| **PyKEEN** | nightly TransE/RotatE training; serialize weights for `/api/kg/predict/learned` |
| **pytrials** | parse eligibility into structured gates; normalize registered results → `trial_analyses` |
| **pyalex** | structured metadata layer (MeSH, funding, IF/OA) + citing-article fetch for living evidence |
| **BioCypher** | ontology engine for bring-your-own-KG CSV ingest with Biolink domain/range validation |
| **ASReview** | ensemble across inclusion+quality+RoB in one pass; per-reviewer prior calibration + boundary provenance |
| **MiniCheck** | negation-aware supporting-sentence selection + `negative_supported` verdict for absence-claims |
| **paper-qa** | wire Retraction Watch / Crossref / JCR clients into ingest for source-quality tiers + evidence chains |
| **STORM** | Claim/Best-Case/Critique/Response structured debate document for mixed verdicts |
| **MultiVerS** | extend label+rationale to cross-source aggregation feeding the Contradiction Atlas |

### New pages / APIs / features / backend

See the workflow result for the full lists — headline items: source-ingest control + coverage
dashboards, entity browser + curation queue, PRISMA flow + SoF, contradiction analysis, safety
signal dashboard, audit/provenance chain viewer, sensitivity/absolute-risk/Bayesian synthesis
pages; `/api/ingest/multi-source`, `/api/entities/normalize|link|verify-outcome-match`,
`/api/retrieval/rerank`, `/api/evidence/prisma-flow|summary-of-findings`,
`/api/verify/contradiction-resolve|subgroup-check`, `/api/safety/signal-detect`,
`/api/audit-chain/verification/[id]`, `/api/kg/predict/learned`, `/api/meta/sensitivity|absolute-risk`.

## Top risks

1. **Scope dilution vs the moat** — guard every deliverable with the ground/rule/provenance test.
2. **Live-API fragility & licensing** — cache aggressively, snapshot-version from day one, verify redistribution rights.
3. **Deterministic-claim correctness liability** — conservative thresholds, honest abstention, human-in-the-loop before any submission-bound assertion.
4. **Engine-specialization maintenance debt** — confine PaperTrail code to named `papertrail/` submodules inside each engine; pin upstream; prefer native TS on hot paths with the Python engine as cross-check.
5. **Cost & latency under load** — cache-everything, LLM-free numeric loop, cap iterative rounds.
6. **Regulatory over-claim** — say "audit-supporting provenance," not "certified," until independent validation.
