# Biomedical-AI Commercial Landscape

*Research date: July 2026. Lens: what bio-AI companies actually MONETIZE, and which capabilities fit
PaperTrail's moat — deterministic biostatistics on real, open bio-data + Claude for reasoning, with a
trust/grounding layer (every claim maps to an exact source substring). PaperTrail has NO wet lab, no
proprietary imaging/omics, no EHR/claims/patient-level data. It CAN consume public APIs: Open Targets
GraphQL, ChEMBL, openFDA/FAERS, GWAS Catalog, ClinVar, PubMed/PubTator3, ClinicalTrials.gov, UniProt,
Reactome, PharmGKB.*

*Only real companies, capabilities, deals, and APIs are recorded here. Unverified figures are flagged.*

---

## The one-line thesis

**Bio-AI monetizes one of two moats: (1) proprietary data/models (wet-lab phenomics, hospital
EHR/pathology, patient-level trial data, GPU-trained generative/structure models), or (2) grounded
reasoning over open bio-data (target validation, literature synthesis, pharmacovigilance, evidence
scoring).** PaperTrail cannot compete on moat (1). Its entire opportunity is to be the best-in-class
version of moat (2): a deterministic, source-anchored **verification and synthesis layer over the same
public inputs** (ChEMBL, Open Targets, openFDA, ClinicalTrials.gov, PubMed) that the moat-(1) companies
consume — the trust layer none of them foreground.

---

## Master table — company × capability × buyer × data sources × PaperTrail-fit

Fit legend: **HIGH** = deterministic on open data + Claude, buildable now · **PARTIAL** = only the
reasoning/evidence half is buildable; the money-making core needs proprietary data/models · **NONE** =
requires wet-lab / imaging / omics / EHR / patient-level / GPU-trained model we do not have.

| Company | What they SELL (concrete capability) | Buyer + willingness to pay | Data sources it relies on | PaperTrail-fit |
|---|---|---|---|---|
| **Open Targets** (EMBL-EBI / Sanger / GSK, BMS, Sanofi, Pfizer, Genentech, MSD consortium) | **Target–disease association evidence scoring** — free Platform; harmonic-sum 0–1 score across evidence datatypes; **public GraphQL API** + CC0 Parquet bulk. Merged Genetics (L2G) in 2025. | Pre-competitive: free/open, industry-funded. No SaaS — the *reference open analog* for target validation. | **All open/CC0:** GWAS Catalog, ClinVar/EVA, ChEMBL, Reactome, Expression Atlas, Europe PMC, IMPC, COSMIC/Cancer Gene Census, UniProt, Ensembl, EFO | **HIGH** — consume as read-only evidence backend; reproduce the harmonic-sum math deterministically |
| **Causaly** | **Cited biomedical causal knowledge graph** + Scientific RAG (deterministic, fully-cited answers); Pipeline/Bio Graph for CI | Pharma/biotech R&D + FDA/NIEHS. Enterprise SaaS; 12 of top-20 pharma. ~$93M raised ($60M Series B, ICONIQ). | **Inputs overwhelmingly open:** PubMed/MEDLINE/PMC, ClinicalTrials.gov, patents, FDA drug labels, adverse-event DBs. Moat = PhD-curated ontologies. | **HIGH** — nearest architectural analog; ingest→extract→cited graph→RAG is exactly PaperTrail's shape |
| **BenchSci** | **AI reagent/antibody selection** (figure-decoded); ASCEND target-triage knowledge graph | Big pharma preclinical R&D; 16 of top-20; Novartis (~$14M savings claim), Sanofi license. ~$170M raised. | Proprietary figure-level CV extraction, **licensed closed-access journals** (Springer/Wiley), vendor reagent catalogs. Public: PubMed/PMC. | **NONE** (reagent core) — needs figure CV + closed corpora + catalog deals |
| **Nference** | **RWE from multimodal clinical data** (nSights) — notes, path, ECG, labs; federated "algorithms-to-data" | Pharma R&D. Access/partnership deals. ~$152M; 12-yr Mayo relationship. | Proprietary de-identified **EHR / clinical notes / pathology slides / ECGs** (Mayo, Duke, Emory). | **NONE** — patient-level EHR moat |
| **Komodo Health** | **Real-world-data platform** — "Healthcare Map," ~330M patients, claims+EHR+payer; MapLab analytics | Pharma commercial/R&D, payers, now investors (Nasdaq deal). Data licensing + SaaS. $3.3B valuation, ~$514M+ raised. | Proprietary de-identified **medical + pharmacy claims (open+closed), EHR, payer, lab/genomics/SDOH**; 60+ feeds. | **NONE** — licensed claims+EHR patient graph |
| **Recursion** (RXRX) | **Phenomics drug discovery** — "Maps of Biology" from proprietary high-content imaging; partnered programs + milestones | Big pharma via milestone+royalty. Roche/Genentech ($150M upfront, ≤40 programs), Sanofi (~$130M), Bayer, Merck KGaA. | ~36–50 PB **proprietary microscopy phenomics, transcriptomics, proteomics**; automated wet lab (2.2M exp/wk). | **NONE** — deepest moat: PB imaging + physical lab + Phenom models |
| **Insilico Medicine** (HKEX 3696) | **End-to-end generative discovery** — PandaOmics (target ID), Chemistry42 (de novo chem), InClinico (trial forecast); rentosertib (IPF, Ph IIa) | Pharma SaaS (13 of top-20) + asset out-licensing. FY25 rev ~$56M; ~$4.6B cumulative deals: Lilly (~$2.75B), Takeda (≤$600M), Sanofi (~$1.2B), SK (≤$2.5B). | **PandaOmics: mostly open** — multi-omics, patents, publications, trials, KG. Chemistry42: ZINC / ~1.5M ChEMBL + AlphaFold2. Moat = generative models + wet lab. | **PARTIAL** — PandaOmics-style **target triage + evidence reasoning** over ChEMBL/PubMed/trials is buildable; generative chemistry is NOT |
| **Genesis Therapeutics** (Genesis Molecular AI) | **Generative molecule design** (GEMS: diffusion + physics-ML); Pearl (3D protein-ligand pose) | Pharma milestone+royalty + own pipeline. Lilly ($20M upfront, ≤~$690M), Gilead, Genentech, NVIDIA. $200M Series B. | **Proprietary physics-based synthetic data** + proprietary wet-lab assay data + MD/QM sims. | **NONE** — GPU generative + structure models + private assays |
| **Iktos** | **Generative molecular design SaaS** (Makya, synthesis-aware) + retrosynthesis (Spaya, RScore) + robotics | SaaS + services + partnerships. Servier (≤€1B), Galapagos, Ono, Pfizer, Chiesi. €15.5M Series A. | **Data layer largely open:** ChEMBL (training), Pistachio reactions, commercial building-block catalogs. Moat = trained cheminformatics models. | **NONE** (core) — data is open but engine is trained generative/retrosynthesis ML |
| **Cradle** (cradle.bio) | **AI protein-engineering SaaS** — generative design-build-test-learn on customer wet-lab data | Enterprise SaaS; protein engineers keep IP. J&J, Novo Nordisk, AbbVie, Grifols. $73M Series B. | Public sequences (pre-train) + **proprietary Amsterdam wet lab** + per-customer private assay data. | **NONE** — owned wet lab + private feedback loops + trained protein models |
| **EvolutionaryScale** (ESM3) | **Frontier protein language model** — generative sequence/structure/function; Forge API, open weights | R&D via API fees + licensing + rev-share. >$142M seed (Nat Friedman/Daniel Gross, Amazon, NVIDIA). | Public **UniProt/UniRef, PDB, MGnify, JGI** (2.78B sequences). Moat = frontier GPU-trained model. | **NONE** — data is public but capability is a ~1e12-teraflop protein LLM |
| **Isomorphic Labs** (Alphabet/DeepMind) | **AI drug design on AlphaFold 3** — structure/interaction prediction + generative chemistry | Big pharma upfront+biobucks+royalties. Lilly (~$45M upfront, ≤$1.7B), Novartis (~$37.5M, ≤$1.2B). $600M round (2025); ~$2.1B Series B reported. | Public **PDB, UniProt, AlphaFold DB** + the AF3 model + Alphabet-scale compute. | **NONE** (core) — structure prediction + de-novo design need custom GPU model; AF-DB *metadata lookup* is adjacent |
| **Owkin** | **Federated learning on hospital data** (Substra) + AI diagnostics (MSIntuit CRC) + discovery services | Pharma licensing/co-dev + hospitals. Sanofi (€90M), BMS, MSD. >$300M raised. | Proprietary **federated hospital pathology/omics** (~35 top hospitals), MOSAIC atlas (~7,000 tumors). | **NONE** — private regulated hospital EHR/pathology/omics + trained imaging models |
| **Tempus** (TEM) | **Molecular + clinical data platform** + NGS diagnostics; de-identified linked data licensing to pharma | Clinicians/payers (per-test) + pharma (data licensing, higher margin). FY24 rev ~$693M; GSK ($70M upfront, ≥$180M), AZ+Pathos (+$200M). | Proprietary **in-house NGS + de-identified EHR linked to molecular + pathology imaging** (Paige/Ambry acquisitions). | **NONE** — patient-level molecular↔outcome linkage |
| **BioXcel** (BTAI) | **FDA-approved drug** (IGALMI) discovered via AI repurposing platform (EvolverAI / PharmGPS) | Clinicians buy the drug; payers reimburse. Thin commercial reality (IGALMI rev ~$2.3M FY24). | EvolverAI ingests **literature, trials, genomic/pharmacological DBs → KG**; value rests on proprietary trial data + FDA approval. | **PARTIAL** — the repurposing-**hypothesis** layer (KG over PubMed+trials+Open Targets+ChEMBL+openFDA) is buildable; the drug business is not |
| **PathAI** | **Computational pathology** — DL on whole-slide images; AISight Dx (FDA-cleared), biomarker scoring | Pharma (trial pre-screen, companion-Dx) + labs/hospitals (license). $315M raised; reported Roche ~$1B (unverified). | Proprietary **digitized pathology imaging** + >32.5M expert annotations. | **NONE** — computer-vision over gigapixel slides; no public equivalent |
| **Paige** (acq. by Tempus 2025) | **Computational pathology** — Paige Prostate (first FDA De Novo AI path); Virchow foundation models | Labs (SaaS), pharma, AI devs (license Virchow). ~$220M+ raised; acquired ~$81M. | Proprietary **MSK ~25M-slide archive**; Virchow2 trained on 3M+ slides. | **NONE** — proprietary imaging + GPU vision training |
| **TrialSpark / Formation Bio** | **AI-native tech-enabled pharma** — in-licenses drug assets, runs trials faster via in-house CRO + AI | *They are the buyer* — asset ownership upside. $372M Series D (a16z, Sanofi). ~$1.8B valuation. | Proprietary operational trial data + (via Sanofi) Sanofi datasets + OpenAI models. | **NONE** (as a business) — needs capital to buy assets + run real trials; only trial-design assistants over ClinicalTrials.gov are software-only |
| **Unlearn.ai** | **Digital-twin control arms** — pretrained prognostic models forecast per-patient control trajectories (PROCOVA / TwinRCTs). **EMA Qualification Opinion (2022)**; FDA concurrence. | Pharma trial sponsors; per-trial B2B licensing. ~$135M raised (Insight, Altimeter). | **Patient-level (individual-participant) longitudinal historical** control-arm/registry data — the entire moat, proprietary. | **NONE** (core) — needs patient-level training corpus; but the *aggregate* side (verify claim vs published ClinicalTrials.gov results) IS PaperTrail's job |
| **Deep Genomics** | **RNA-therapeutic foundation model** (BigRNA, ~2B params) — predicts regulation, designs oligos; own pipeline | VC + platform-enabled partnerships. ~$238M ($180M Series C, SoftBank). | Large-scale genomic/transcriptomic sequence data; moat = **2B-param model weights + wet-lab validation**. | **NONE** — genomics foundation model + wet lab |
| **Verge Genomics** | **All-in-human CNS discovery** (CONVERGE) — proprietary human-brain multi-omics → targets; own pipeline | VC + pharma partnerships. Lilly ($25M upfront, ≤$694M), Alexion/AZ (≤$840M). $98M Series B. | Proprietary **multi-omics from 1,000+ human brains** + wet-lab validation. | **NONE** — proprietary human-tissue multi-omics + wet lab |

---

## Data-source reference (what the fits are built on)

Only sources that are **free for commercial use** are safe to build on. Two classic gotchas —
**DrugBank** and **DisGeNET** — are NOT free for commercial use and their capabilities have open
substitutes below.

| Source | Access | Commercial use | Enables (deterministic capability) |
|---|---|---|---|
| **openFDA / FAERS** | REST + bulk, CC0 | ✅ freely | Pharmacovigilance disproportionality (PRR / ROR / EBGM) — compute yourself from 2×2 counts |
| **Open Targets** (+Genetics) | GraphQL + CC0 Parquet | ✅ | Target–disease evidence scoring (harmonic sum), genetic-association verification |
| **ChEMBL** | REST + bulk, CC BY-SA 3.0 | ✅ (attribution + share-alike) | Drug–target bioactivity lookup (IC50/Ki/Kd), mechanism of action, clinical phase |
| **ClinicalTrials.gov API v2** | REST, public domain (v1 retired 2024) | ✅ | Trial existence/status/phase/sponsor + posted results verification |
| **PubMed E-utilities + PubTator3** | REST + FTP, public domain | ✅ (metadata) | Citation/provenance resolution; entity grounding to canonical IDs → source spans |
| **ClinVar** | E-utilities + FTP, public domain | ✅ | Variant pathogenicity + star-rated review-status confidence |
| **GWAS Catalog** | 2× REST + bulk, EMBL-EBI TOU / CC0 | ✅ mostly (few CC BY-NC datasets) | SNP–trait association verification (p-value, effect size, risk allele, PMID) |
| **UniProt** | REST, CC BY 4.0 | ✅ (attribution) | Protein annotation + gene↔protein ID mapping (normalization backbone) |
| **Reactome** | 2× REST, data CC0 | ✅ | Pathway membership + enrichment/overrepresentation |
| **PharmGKB / ClinPGx** | REST + bulk, CC BY-SA 4.0 | ✅ (mind CPIC nuances) | Pharmacogenomic gene/variant–drug annotation + evidence level + dosing |
| **cBioPortal** | REST, ODbL | ⚠️ default yes; per-study + TCGA gotchas | Cancer mutation frequency by cohort |
| **DepMap** (Broad) | Bulk download only, CC BY 4.0 | ✅ | Gene essentiality / dependency by cell line (Chronos) — no query API |
| **DrugBank** | Paid API / academic DL | ❌ **paid license** (only CC0 vocab/structures safe) | DDI + drug-target — use Open Targets / ChEMBL / FAERS substitutes instead |
| **DisGeNET** | Login-gated REST | ❌ **paid + no resale even when paid** | Gene–disease association — use Open Targets genetic evidence instead |
| **DDInter / TWOSIDES** | Downloads | ❌ non-commercial / license unverified | DDI signals — derive yourself from live CC0 FAERS instead |

---

## What sells — synthesis

**1. The money is in one of two moats.** Every company above monetizes either (a) proprietary
data/models — phenomics imaging (Recursion), hospital EHR/pathology (Nference, Owkin, Tempus, PathAI,
Paige), claims (Komodo), patient-level trial trajectories (Unlearn), or GPU-trained generative/structure
models (Insilico Chemistry42, Genesis, Iktos, Cradle, ESM3, Isomorphic, Deep Genomics) — or (b) grounded
reasoning over *open* bio-data (Open Targets, Causaly, and the PandaOmics/EvolverAI reasoning layers).
PaperTrail can only play in (b).

**2. Pharma pays the most, for target validation and trial de-risking.** The largest willingness-to-pay
is enterprise pharma R&D: multi-hundred-million-dollar milestone deals for discovery (Lilly, Sanofi,
Novartis, Roche, Takeda) and high-margin data licensing (Tempus Data & Services ~72% gross margin; GSK
$70M+ deals). The recurring buyer job-to-be-done is **"is this target/claim/trial result actually
supported by evidence?"** — which is exactly what PaperTrail verifies.

**3. The winners in moat (b) sell CITED, TRACEABLE answers — not just answers.** Open Targets' entire
value is a *transparent, reproducible* association score with a citation trail. Causaly's differentiator
is "deterministic, fully-cited, auditable." This validates PaperTrail's core bet: in life sciences, the
grounding/trust layer *is* the product. A confident-but-unsourced answer is a liability; an honest
"no_support_found" with a citation trail is the asset.

**4. The open inputs are the same across the whole field.** ChEMBL, Open Targets, PubMed,
ClinicalTrials.gov, openFDA, GWAS Catalog, UniProt — these are consumed as *inputs* even by the
proprietary-moat companies (Insilico trains Chemistry42 on ChEMBL; Iktos too; everyone reads PubMed).
PaperTrail's wedge is to turn those same public inputs into a **deterministic, source-anchored
verification product** — the layer none of the moat-(1) companies foreground because their differentiation
lives elsewhere.

**5. Two nearest reference architectures for PaperTrail:** **Open Targets** (deterministic evidence
scoring on open data — reproduce/consume its harmonic-sum model) and **Causaly** (cited literature
synthesis — ingest→extract→graph→grounded RAG). Build toward the intersection: deterministic biostatistics
on open bio-data, with Claude reasoning and a claim→substring trust layer on top.
