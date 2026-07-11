# PaperTrail — OSS Engine Architecture & Claude Usage

How each of the 17 vendored OSS engines is used in the product, and **exactly where the Claude API
runs vs. where the path is deterministic**. Every engine has a PaperTrail-native `papertrail_*.py`
under `backend/engines/<engine>/`, a native TypeScript module in `lib/`, and an `app/api` route.

> **The moat rule, visible in every diagram:** Claude is used **only** for a language step
> (extraction / judgment / tagging / prose), and its output is always **grounded** (every quoted
> span must be a verbatim substring of the source, or it is dropped). **No LLM is ever in a
> numeric / verdict / scoring path** — those are deterministic and reproducible. That separation is
> what produces the fair-benchmark result (PaperTrail 95% vs Claude-alone 75% on efficacy-magnitude
> claims): the deterministic recompute catches subtle distortions a fluent LLM waves through.

## Claude-usage map

| Engine | Route | Claude step | Runs with Claude | Deterministic core |
|---|---|---|:--:|---|
| MiniCheck | `/api/verify/absence-claim` | presence/absence judgment | ✅ default | polarity detection, label table, grounding |
| Valsci | `/api/verify/contradiction-resolve` | design-feature tagging | ✅ default | side partition, dimension scoring, resolution |
| INDRA | `/api/mechanism` | causal-statement extraction | ✅ default | dedup, belief combination, KG upsert |
| scispaCy | `/api/entities` | NER mention proposal | ✅ default | Schwartz-Hearst, grounding, KB linking |
| Loki / OpenFactVerification | `/api/retrieval/rerank` | on-topic relevance tag | ✅ **now default** | claim-frame extraction + overlap ranking |
| STORM | `/api/synthesis/debate` | connective prose only | ✅ default | evidence ranking, stance, grounding |
| MultiVerS | `/api/scieval/aggregate` | — (labels assigned upstream) | deterministic | confidence-weighted tally + classification |
| paper-qa | `/api/sources/quality-tier` | — | deterministic | tier rubric + weight (retracted → 0) |
| R2R | `/api/retrieval/hybrid` | — | deterministic | facet decomposition + RRF fusion |
| open_deep_research | `/api/deep-research/iterative` | — | deterministic | sufficiency gate + widen loop (capped) |
| PyKEEN | `/api/kg/predict/learned` | — | deterministic | TransE embeddings (fixed seed) |
| BioCypher | `/api/kg/import` | — | deterministic | Biolink domain/range validation |
| pyalex | living-evidence monitor | — | deterministic | OpenAlex citation velocity |
| pytrials | `/api/trials/design` | — | deterministic | eligibility parse + design credibility |
| ASReview | `/api/screening/ensemble` | — | deterministic | TF-IDF + 3-head Naive Bayes ensemble |
| PyMARE | `/api/meta/bayesian`, `/api/meta/sensitivity` | — | deterministic | closed-form Bayesian + leave-one-out |
| FAERS / ClinVar / ChEMBL | ingest → `/api/ingest/multi-source` | — | deterministic | live fetch → normalize → cache-once |

Legend: **red** node = Claude step · **blue** = deterministic · **green** = grounding gate.

---

## Verification engines

### MiniCheck — negation-aware absence-claim verification

```mermaid
graph TD
  Input["Input: claim, source_text"] --> Polarity["(Deterministic) detectPolarity()\nnegation-cue lexicon → positive | negative"]
  Polarity --> ClaudeStep["(Claude) callClaudeForJson\npolarity-neutral: source asserts\npresence | absence | neither?\nreturns verbatim supporting_sentence"]
  ClaudeStep --> Ground["(Deterministic) locateSpan()\nground supporting_sentence in source_text"]
  Ground -->|located| LabelMap["(Deterministic) map_label()\nfixed table: polarity × source_assertion → label"]
  Ground -->|not located| DropAndNei["drop span → nei (grounding_dropped=true)"]
  LabelMap --> Output["VerifyAbsenceResult\n{polarity, label, score, supporting_span}"]
```

### MultiVerS — cross-source label aggregation

```mermaid
graph TD
  Input["sources[] {id, label: SUPPORTS|REFUTES|NEI, confidence?}"] --> Tally["(Deterministic) confidence-weighted tally\nSUPPORTS→supportMass, REFUTES→refuteMass, NEI→neiMass"]
  Tally --> Classify["(Deterministic) classify()\ndirectional=support+refute; ≤0→insufficient;\n≥70% support→supported; ≥70% refute→refuted; else mixed"]
  Classify --> Output["CrossSourceAggregate {verdict, netConfidence, tally, ...}"]
```

### Valsci — quantitative contradiction atlas

```mermaid
graph TD
  Input["claim, sources[]"] --> Partition["(Deterministic) sideForSupport()\npartition by sign of support"]
  Partition --> Claude["(Claude) claudeFeatureTagger\ntag {dimension, value, verbatim quote}"]
  Claude --> Ground["(Deterministic) groundFeatures()\nlocate quote verbatim; drop ungroundable"]
  Ground --> ScoreDim["(Deterministic) scoreDimension()\nboth sides report it? values disjoint?\nstrength = 0.7·coverage + 0.3·belief"]
  ScoreDim --> Resolve["(Deterministic) resolve()\nwinning dimension ≥ 0.35? else unattributed_conflict"]
  Resolve --> Output["ContradictionAtlasResult {resolution_category, primary_hypothesis, attributions[]}"]
```

### Loki / OpenFactVerification — claim-frame reranker

```mermaid
graph TD
  Input["claim, sources[] {id,text}, threshold?"] --> Extract["(Deterministic) extractClaimFrame()\n{subject[], predicate, direction, object[], modifiers[]}"]
  Extract --> Score["(Deterministic) frameOverlapScore()\n0.45·subject + 0.40·object + 0.15·modifiers + 0.05·predicate"]
  Score --> Filter["(Deterministic) rank & drop at threshold"]
  Filter --> Claude["(Claude) defaultJudge\non_topic tag + verbatim quote per survivor\n(advisory — never re-ranks)"]
  Claude --> Ground["(Deterministic) groundRelevance()\nlocate quote; drop ungroundable"]
  Ground --> Output["RankByClaimFrameResult {ranked[], droppedIds[]}"]
```

---

## Retrieval & research engines

### paper-qa — source-quality tiers

```mermaid
graph TD
  A["source metadata\n(journal, citations, retracted, OA)"] --> B["(Deterministic) scoreSourceQuality()"]
  B --> C["tier A/B/C/D + weight\nretracted → hard-cap D, weight 0"]
  C --> D["POST /api/sources/quality-tier → evidence weighting"]
```

### R2R — RAG-fusion faceted retrieval

```mermaid
graph TD
  A["query"] --> B["(Deterministic) decomposeIntoFacets()\nefficacy | safety | mechanism | subgroup"]
  B --> C["(Deterministic) per-facet hybrid retrieval"]
  C --> D["(Deterministic) reciprocal-rank fusion (RRF)\n+ per-facet provenance"]
  D --> E["POST /api/retrieval/hybrid + evidenceSufficiency gate"]
```

### STORM — structured debate for mixed verdicts

```mermaid
graph TD
  A["claim + supporting/refuting snippets"] --> B["(Deterministic) scoreSnippet + rankSide"]
  B --> C["(Deterministic) computeStance\n(balanced | leans | one_sided | insufficient)"]
  C --> G["(Deterministic) groundSide + locateSpan\ndrop ungroundable quotes"]
  G --> Claude["(Claude) prose bridges only\n(best-case / critique / synthesis intros)\nnever stance, rank, or quote"]
  Claude --> Out["POST /api/synthesis/debate → structured debate"]
```

### open_deep_research — iterative sufficiency loop

```mermaid
graph TD
  A["per-round stats {k, participants, I², contradictions}"] --> B["(Deterministic) evidenceSufficiency gate\n≥3 studies? ≥100 participants? I²<75%? 0 contradictions?"]
  B -->|all met| F["STOP: sufficient"]
  B -->|not met| G["(Deterministic) decideWidenAction\nraise_limit | add_facet | broaden_query"]
  G --> H["loop, capped at MAX_ROUNDS=3"]
  H --> J["POST /api/deep-research/iterative"]
```

---

## Biomedical KG & NLP engines

### INDRA — mechanism assembly

```mermaid
graph LR
  A["source text"] --> B["(Claude) extract causal statements\nsubj/rel/obj + verbatim quote"]
  B --> C["(Deterministic) locateSpan — ground each quote"]
  C --> D["(Deterministic) dedupe + merge evidence"]
  D --> E["(Deterministic) combineBelief = 1 − ∏(1 − r_i)"]
  E --> F["(Deterministic) upsertEdge → kg_nodes/kg_edges"]
  F --> G["POST /api/mechanism"]
```

### scispaCy — NER + entity linking

```mermaid
graph LR
  A["source text"] --> B["(Claude) propose mention spans + types"]
  B --> C["(Deterministic) Schwartz-Hearst abbreviations"]
  C --> D["(Deterministic) locateSpan — ground each mention"]
  D --> E["(Deterministic) linkMention → CURIE (BIOMEDICAL_DICTIONARY)"]
  E --> F["POST /api/entities"]
```

### PyKEEN — learned link prediction

```mermaid
graph LR
  A["kg_edges (subject/predicate/object)"] --> B["(Deterministic) TransE trainer\nFNV-1a seed init, margin-ranking SGD, 100 epochs, dim=16"]
  B --> C["(Deterministic) unit-sphere normalize → embeddings"]
  C --> D["(Deterministic) transeDistance → rank candidates"]
  D --> E["POST /api/kg/predict/learned"]
```

### BioCypher — bring-your-own-KG import

```mermaid
graph LR
  A["CSV nodes + edges"] --> B["(Deterministic) toBiolinkCategory\n+ isWellTypedTriple (domain/range)"]
  B -->|well-typed| G["(Deterministic) upsertNode/upsertEdge"]
  B -->|ill-typed| H["rejected[] with reason"]
  G --> I["kg_import_batches audit + POST /api/kg/import"]
  H --> I
```

---

## Sources, screening & meta engines

### pyalex — citation velocity (living-evidence signal)

```mermaid
graph LR
  A["OpenAlex work id / DOI"] --> B["(Deterministic) fetch counts_by_year"]
  B --> C["(Deterministic) classify trend + peak year"]
  C --> D["living-evidence monitor timeline (supporting signal, never decides)"]
```

### pytrials — eligibility parse + design credibility

```mermaid
graph LR
  A["eligibility text + design fields"] --> B["(Deterministic) parseEligibility → inclusion/exclusion gates"]
  A --> C["(Deterministic) scoreDesignCredibility\nrandomized/blinding/enrollment/phase → tier + priorWeight"]
  B --> D["POST /api/trials/design"]
  C --> D
```

### ASReview — ensemble screening

```mermaid
graph LR
  A["labeled abstracts (include/quality/rob)"] --> B["(Deterministic) TF-IDF + 3-head Naive Bayes"]
  E["unlabeled abstracts"] --> B
  B --> G["(Deterministic) combine posteriors → priority + decidingAxis"]
  G --> I["POST /api/screening/ensemble → ranked worklist"]
```

### PyMARE — Bayesian + sensitivity meta

```mermaid
graph LR
  A["studies (RR/HR/OR + CI)"] --> B["(Deterministic) standardize to log-effects + DL τ²"]
  B --> C["(Deterministic) conjugate Normal-Normal posterior + predictive interval"]
  B --> D["(Deterministic) leave-one-out re-pool → influence"]
  C --> E["POST /api/meta/bayesian"]
  D --> F["POST /api/meta/sensitivity"]
```

### FAERS / ClinVar / ChEMBL — evidence-integrator ingest

```mermaid
graph LR
  A["drug / variant / molecule query"] --> B["(Deterministic) run.py → live fetch\nOpenFDA FAERS · NCBI ClinVar · ChEMBL REST"]
  B --> C["(Deterministic) normalize verbatim + snapshot hash"]
  C --> D["(Deterministic) lib/ingest/drivers/* → cache-once"]
  D --> E["sources cache → /api/ingest/multi-source"]
```

---

## "Run with Claude at full capacity"

Five engines call Claude by default (MiniCheck, Valsci, INDRA, scispaCy, STORM). The **Loki
reranker** was Claude-capable but off — its grounded relevance pass is now enabled by default on
`/api/retrieval/rerank` (pass `llm: false` for the pure deterministic ranking). The remaining
engines are deterministic **by design**: their outputs are numbers/verdicts that must be reproducible and
audit-defensible — putting an LLM in that path is exactly what PaperTrail refuses to do, and is why
it beats a plain LLM on the fair benchmark. Where a natural-language explanation of a deterministic
result is useful, an **optional grounded Claude explanation layer** can be added per route without
touching the numeric core (the same pattern the bio engines already use via `summarize`).
