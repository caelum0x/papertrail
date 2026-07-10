# PaperTrail Bio Backend Roadmap

*A prioritized backlog of BACKEND biology capabilities PaperTrail should build, derived from
`docs/bio-commercial-landscape.md`. Each is a deterministic-on-open-data capability (Claude for reasoning
only), buildable without wet-lab/imaging/omics/EHR data, with a claim→exact-source-substring trust layer.*

## Ranking method

Ranked by **commercial value to pharma × moat-fit (deterministic + grounded + Claude) ×
buildability-without-proprietary-data**. Favor CC0 / permissive-licensed sources with real APIs. Avoid
DrugBank and DisGeNET (paid, redistribution-restricted) — every capability below uses an open substitute.

Tags per item: `[engine]` deterministic computation core · `[api]` external route to serve/consume ·
`[data-source]` ingestion + caching of a public DB · `[deterministic]` math is reproducible, no LLM in
the load-bearing path · `[claude]` Claude used for normalization/summarization/explanation only, always
downstream of a deterministic result.

Every capability MUST honor the two project conventions: (1) all LLM structured output validated against a
Zod schema in `lib/schemas.ts`; (2) every result includes `flagged_spans` mapping to an exact substring of
cached source `raw_text`. Cache all fetched data in Postgres — never depend on live API latency in the demo.

---

## Tier 1 — Build first (highest commercial value × cleanest fit × CC0/permissive)

### 1. Pharmacovigilance disproportionality signal detection
`[engine][data-source][deterministic]` · **Source: openFDA / FAERS (CC0)** · **Buyer: pharma drug-safety / PV teams, regulators**

Compute **PRR, ROR (+95% CI), and EBGM (EB05)** per drug–event pair from FAERS 2×2 contingency tables.
This is pure deterministic biostatistics on public-domain data — the single strongest fit. Ingest quarterly
FAERS extracts (DEMO/DRUG/REAC/OUTC) into Postgres; compute the full drug×event count matrix; flag signals
(PRR ≥ 2, χ² ≥ 4, a ≥ 3; ROR CI lower bound > 1; EB05 ≥ 2). Claude only summarizes the flagged signal with
a citation trail. Highest willingness-to-pay job: "does this drug's claimed safety profile hold up against
real adverse-event reporting?"

### 2. Target–disease association evidence scoring
`[engine][api][data-source][deterministic]` · **Source: Open Targets GraphQL + CC0 Parquet** · **Buyer: pharma R&D target-validation teams**

Consume (and locally reproduce) Open Targets' **harmonic-sum association score** (per-datasource →
per-datatype → overall; normalize by ≈1.644 = π²/6; configurable weights; direct vs indirect via EFO
propagation). Cache Parquet into Postgres for determinism; hit GraphQL for on-demand lookups. This is the
closest open analog to a full commercial capability and the reference architecture for the whole platform.
Underlying evidence: GWAS Catalog, ClinVar, ChEMBL, Reactome, Europe PMC, IMPC, COSMIC, UniProt.

### 3. Clinical-trial claim verification
`[engine][api][data-source][deterministic][claude]` · **Source: ClinicalTrials.gov API v2 (public domain) + PubMed** · **Buyer: pharma medical-affairs, regulators, publishers — core PRD use case**

Given a claim (e.g. "Drug X reduced FVC decline by 30%"), resolve the NCT ID, pull registered
status/phase/sponsor + posted results (participant flow, outcome measures, adverse events), and
deterministically compare the claimed effect to the reported primary/secondary outcome. Flag discrepancies;
return `no_support_found` when no confident match. Claude normalizes the claim and explains the flag; the
comparison itself is deterministic. This is PaperTrail's headline capability.

### 4. Genetic-association verification
`[engine][api][data-source][deterministic]` · **Source: GWAS Catalog REST + Open Targets Genetics** · **Buyer: pharma genetics / target-ID teams**

Verify "variant/gene X is associated with trait/disease Y" against GWAS Catalog (p-value, effect size/OR,
risk allele, mapped gene, source PMID) and Open Targets L2G locus-to-gene evidence. Deterministic lookup +
genome-wide-significance check (p < 5e-8), with every assertion mapped to the source study. Genetic evidence
is the single highest-value evidence type in modern target validation.

### 5. Entity grounding & citation-provenance resolution
`[engine][data-source][api][deterministic][claude]` · **Source: PubTator3 + PubMed E-utilities (public domain)** · **Buyer: cross-cutting infrastructure for every other capability**

Normalize a claim's entities (gene, disease, chemical, variant) to canonical IDs (NCBI Gene, MeSH, dbSNP,
EFO) via PubTator3, and resolve every cited reference to a real PubMed record with `elink` citation chains.
This is the backbone that makes `flagged_spans` map to exact source substrings across all capabilities.
Claude proposes the entity span; PubTator3 + deterministic ID resolution confirm it.

---

## Tier 2 — High value, slightly more assembly or narrower buyer

### 6. Drug–target bioactivity & mechanism verification
`[engine][data-source][api][deterministic]` · **Source: ChEMBL REST + bulk (CC BY-SA 3.0)** · **Buyer: pharma R&D, competitive intelligence**

Verify claimed potency (IC50/Ki/Kd/EC50), mechanism of action, and clinical phase against ChEMBL's curated
bioactivity records, with assay provenance. Deterministic lookup — flag when a claimed potency is
unsupported or contradicted. Honor ChEMBL attribution + share-alike on any redistribution.

### 7. Drug-repurposing evidence & hypothesis grounding
`[engine][claude][deterministic]` · **Sources: Open Targets + ChEMBL + openFDA + ClinicalTrials.gov** · **Buyer: pharma R&D, repurposing-focused biotech (the replicable half of BioXcel EvolverAI)**

Assemble a deterministic evidence bundle for a proposed drug↔indication link — shared targets (Open
Targets), known mechanism (ChEMBL), existing/failed trials (ClinicalTrials.gov), and safety signals
(FAERS) — and let Claude rank/explain candidate links with every claim mapped to a source span. The
deterministic bundle is load-bearing; Claude only synthesizes.

### 8. Variant pathogenicity check
`[engine][data-source][api][deterministic]` · **Source: ClinVar E-utilities + VCF (public domain)** · **Buyer: pharma translational, clinical-genomics teams**

Return aggregate clinical significance (Pathogenic / Likely pathogenic / VUS / Benign / conflicting) plus
star-rated review status (0–4) for a variant. Deterministic; flag when a claim overstates certainty (e.g.
calling a 1-star VUS "pathogenic"). Pairs naturally with #4.

### 9. Biomarker validation evidence
`[engine][claude][deterministic]` · **Sources: Open Targets + ChEMBL + PubTator3 + ClinicalTrials.gov** · **Buyer: pharma translational / companion-Dx teams**

For a claimed biomarker–disease or biomarker–response relationship, deterministically assemble genetic
evidence (Open Targets), drug-response context (ChEMBL/trials), and literature grounding (PubTator3), and
report supporting vs. contradicting evidence with a trust score. Return `no_support_found` honestly when
weak.

### 10. Pharmacogenomic annotation verification
`[engine][data-source][api][deterministic]` · **Source: PharmGKB / ClinPGx REST + bulk (CC BY-SA 4.0)** · **Buyer: pharma clinical-pharmacology, precision-medicine teams**

Resolve a gene/variant–drug pair to its curated clinical annotation, evidence level (1A–4), and dosing
guideline; flag claims that misstate the evidence level or contradict CPIC guidance. Mind CPIC-derived
content nuances.

---

## Tier 3 — Valuable add-ons / breadth

### 11. Drug–drug-interaction evidence (open, FAERS-derived)
`[engine][data-source][deterministic]` · **Source: openFDA / FAERS (CC0) — self-derived** · **Buyer: pharma safety, clinical teams**

Deliberately AVOID DrugBank/DDInter (paid / non-commercial). Instead derive DDI-adverse-event signals
in-house from live CC0 FAERS (drug-pair co-reporting disproportionality, à la a fresh TWOSIDES) so the
data is current and commercially clean. Extends the #1 engine to drug pairs.

### 12. Drug-target–disease mechanism graph
`[engine][data-source][claude][deterministic]` · **Sources: Open Targets + UniProt + Reactome + ChEMBL** · **Buyer: pharma R&D mechanism-of-action / MoA teams**

Build a deterministic target→pathway→disease graph (UniProt for gene↔protein normalization, Reactome for
pathway membership, Open Targets for disease links, ChEMBL for drug modulators) and let Claude explain a
claimed mechanism against it, flagging steps with no supporting edge. This is the Causaly-shape capability
on fully open sources.

### 13. Real-world-evidence consistency check (aggregate only)
`[engine][data-source][claude][deterministic]` · **Sources: ClinicalTrials.gov results + openFDA labels + PubMed** · **Buyer: pharma medical-affairs, HEOR, publishers**

Cross-check a claim against *aggregate* published/registered results across multiple trials and the FDA
label — explicitly NOT patient-level (that is Unlearn/Tempus/Komodo territory, out of reach). Flag when a
marketing/press claim overstates the aggregate registered evidence. Sits on the exact open-data side of the
line where patient-level RWE becomes proprietary.

### 14. Pathway-enrichment context for gene-set claims
`[engine][data-source][api][deterministic]` · **Source: Reactome Analysis Service (CC0 data)** · **Buyer: pharma R&D, bioinformatics support**

Given a claimed "gene set X is enriched for pathway/process Y," run deterministic overrepresentation
analysis via Reactome's token-based Analysis Service and report the actual enriched pathways with stats —
flagging unsupported enrichment claims.

### 15. Cancer mutation-frequency verification
`[engine][data-source][api][deterministic]` · **Source: cBioPortal REST (ODbL)** · **Buyer: oncology-focused pharma/biotech R&D**

Verify claims like "gene X is mutated in Y% of tumor type Z" against cBioPortal cohort queries
(TCGA/GENIE/MSK). Deterministic; note ODbL share-alike and per-study/TCGA controlled-access caveats. Lower
priority due to licensing nuance and narrower (oncology-only) buyer.

---

## Sequencing recommendation

Ship **Tier 1 (#1–#5)** first: they cover the two nearest reference architectures (Open Targets evidence
scoring, cited literature grounding), the headline PRD use case (trial verification), the highest-value
open-data biostatistics (pharmacovigilance, genetic association), and the provenance backbone that every
other capability depends on. Tier 2 broadens the drug/variant/biomarker surface; Tier 3 adds
mechanism-graph and breadth. Every item is buildable on CC0/permissive open data with Next.js/TS/Postgres +
Claude — no wet lab, imaging, omics, or patient-level data required.
