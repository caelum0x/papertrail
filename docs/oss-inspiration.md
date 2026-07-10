# Open-Source Inspiration — PaperTrail

Open-source projects worth studying, porting, or cloning for PaperTrail's
extraction / verification / synthesis stack. Sourced entirely from the research JSON.

PaperTrail is Next.js 14 / TypeScript / Postgres+pgvector / Anthropic Claude with a
**deterministic engine as the trust layer**. Most of these projects are Python — we
borrow *patterns and architecture*, not necessarily code. The two that map most directly
to our mission are **PaperQA2** (extraction/verification) and **STORM/Co-STORM** (grounded
synthesis).

---

## OSS Project Table

| Name | Repo | License | Standout features | Architecture notes | What to borrow |
|------|------|---------|-------------------|--------------------|----------------|
| **PaperQA2 (paper-qa)** | [Future-House/paper-qa](https://github.com/Future-House/paper-qa) | Apache-2.0 | Three-phase agent loop (Paper Search → Gather Evidence → Generate Answer); query-aware contextual summarization with LLM re-ranking (RCS); metadata-aware retrieval (citation counts, journal quality, retraction status via Crossref/S2/Unpaywall); in-text citations grounded to sources; multimodal (tables/figures/equations); Pydantic Settings presets (fast/high_quality/wikicrow); per-model rate limiting; LiteLLM, framework-agnostic. | Agent-as-orchestrator invoking discrete search/evidence/answer tools with quality-driven iteration. Evidence scored per-chunk before synthesis. Async-first `Docs` core. Tantivy local full-text search alongside vector embeddings. | Per-chunk scored contextual summarization before a chunk can enter the answer (→ our `flagged_spans`); `DocMetadataClient` multi-source enrichment (esp. **retraction status**); "gather evidence with scores, refuse if none clear threshold" (→ our `no_support_found`); Settings presets for fast vs high-quality demo modes to control $200 token budget. |
| **STORM / Co-STORM (Stanford OVAL)** | [stanford-oval/storm](https://github.com/stanford-oval/storm) | MIT | Two-stage pipeline (pre-writing research → citation-grounded writing); multi-perspective question asking (discovers viewpoints from related articles); simulated writer↔expert conversation grounded in sources; Co-STORM human-in-the-loop with moderator agent + dynamic mind-map; pluggable retrievers (Vector, Bing, Serper, Tavily, SearXNG, DuckDuckGo, Azure AI Search). | Perspective-guided research → diverse questions → grounded answers → outline → sectioned prose with inline citations. Co-STORM adds moderator agent + persistent mind-map across long sessions. | Multi-perspective question generation for meta-analysis/synthesis (efficacy, safety, subgroups, risk-of-bias sub-questions → defensible evidence map); Co-STORM dynamic mind-map as a citation-trail / evidence-network UI; outline-then-write separation so every prose span traces to a source (→ no-unsourced-claims). |
| **GPT Researcher** | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Apache-2.0 | Planner → parallel Execution agents → Publisher; recursive "Deep Research" subtopic tree (~5 min, ~$0.40/query); LangGraph/AG2 multi-agent team mode; MCP hybrid retrieval; local doc research (PDF/CSV/Excel); multi-format export (PDF/Word/MD); LangSmith tracing. | Planner decomposes query into research questions; parallel execution agents gather per-question; publisher aggregates with citations. Deep-research recurses tree-style. Parallelization is the key latency/reliability lever. | Parallel-executor pattern to fan out multi-source verification (PubMed + CT.gov + citing papers concurrently) and cache (→ "demo must not depend on live latency"); recursive deep-research tree for citation-chasing to primary source through intermediate reviews; report-export pipeline (PDF/Word) for the "defensible citation trail" deliverable. |
| **Open Deep Research (LangChain)** | [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research) | MIT | Agentic LangGraph loop with role-specialized models (summarization, research, compression, report-generation); legacy plan-and-execute + supervisor-researcher implementations for reference; full MCP compatibility; central `configuration.py` (model/search/MCP/behavior params via LangGraph Studio); benchmarked (RACE score), transparent eval. | Single agentic loop; separate "compression" model synthesizes findings before a report model writes. Distinct role-models let you cheap-out on high-volume steps and spend on synthesis. Clean reference architecture. | Role-specialized model graph — cheap Haiku-class model for summarization/compression, strongest model reserved for verification-comparison (cuts token cost); explicit **compression stage** before verification to bound the evidence set; `configuration.py` as a clean template for our Settings/env surface. |
| **txtai** | [neuml/txtai](https://github.com/neuml/txtai) | Apache-2.0 | Embeddings database unifying sparse+dense vectors + graph network + relational DB with SQL; GraphRAG (entity extraction + knowledge-graph traversal); citation-aware RAG with provenance tracking; LLM orchestration (prompt pipelines, RAG workflows, agents); REST/MCP APIs + JS/Java/Rust/Go bindings; multimodal. | Single `Embeddings` object combines vector similarity, SQL filtering, and graph relationships in one queryable store — hybrid retrieval + KG reasoning without separate infra. | Hybrid-retrieval lesson: combine pgvector similarity + SQL metadata filters + a citation-relationship graph in one retrieval step; GraphRAG (entity extraction + traversal) for our citation network / evidence graph across trials; provenance-tracking RAG to reinforce flagged_spans→source mapping. (Reference, not wholesale adoption — we keep Postgres+pgvector.) |
| **Haystack (deepset)** | [deepset-ai/haystack](https://github.com/deepset-ai/haystack) | Apache-2.0 | Composable Pipelines of typed Components (retrievers, rankers, routers, generators); "context engineering" — explicit control over retrieve/rank/filter/combine/route; agent workflows + tool calling with memory; first-class RAG evaluation components; model-agnostic (Anthropic, OpenAI, Bedrock, HF, local); pluggable Document Stores (pgvector supported). | Directed-graph pipelines wire typed components with explicit inputs/outputs — transparent, testable data flow instead of black-box chains. Strong evaluation story, production adoption. | Typed-component pipeline mindset to make the deterministic engine auditable — each retrieve/rank/filter/verify step as an explicit, individually-testable stage (→ Zod-validated boundaries); **evaluation components** — an eval harness scoring the verification pipeline against `tests/fixtures/test-claims.json` (faithfulness, citation-correctness) instead of eyeballing demo runs. |
| **LlamaIndex** | [run-llama/llama_index](https://github.com/run-llama/llama_index) | MIT | Data connectors, indices/graphs, retrievers, citation-capable query engines; event-driven Workflows + document agents; LlamaParse (agentic OCR/parsing of 130+ formats incl. tables/complex PDFs); LlamaExtract (schema-driven structured extraction); 300+ integrations via LlamaHub. | Layered: connectors → indices/graphs → retriever+query → integrations. Workflows = event-driven agent orchestration. LlamaParse/LlamaExtract are the standout document-intelligence layer. | `CitationQueryEngine` pattern — attaches source-node references to each answer sentence (template for flagged_spans→raw_text); LlamaExtract's schema-driven extraction loop (parallels our "validate every LLM output against a Zod schema" rule); LlamaParse as a reference for parsing messy clinical-trial PDFs/tables from PubMed/CT.gov. |
| **Aviary (FutureHouse) + LDP** | [Future-House/aviary](https://github.com/Future-House/aviary) | Apache-2.0 | Gymnasium-style async `reset()`/`step()` interface with tool-based actions + typed State; standardized Message / ToolRequestMessage / ToolResponseMessage protocol; `Tool.from_function()` (docstring → tool); pre-built scientific environments (LAB-Bench, LFRQA, HotPotQA, GSM8K, Notebook); pairs with LDP for training/eval; multimodal. | Clean agent↔environment separation with a rigorous message protocol + optional hidden-state injection → reproducible, comparable agent evaluation. Same authors as PaperQA. | Environment/message-protocol abstraction to wrap our verification pipeline as a reproducible task environment — systematically benchmark against `test-claims.json` and catch regressions (CLAUDE.md DoD wants tested, not clicked); `Tool.from_function` docstring-parsing for self-documenting tool schemas. Shares lineage with PaperQA2 — adopting both aligns our stack with a proven scientific-agent lineage. |
| **SciPhi R2R** | [SciPhi-AI/R2R](https://github.com/SciPhi-AI/R2R) | MIT | Native citation support in the RAG API (`client.retrieval.rag` returns cited answers); distinct retrieval methods (basic search, RAG-with-citations, Deep Research agent); hybrid search + reranking; ingestion pipeline; local-LLM cookbook; containerized with a Next.js management dashboard (R2R-Application); RESTful API. | Server + RESTful API with citation handling built into the retrieval layer (not bolted on). Ships a **Next.js dashboard** — architecturally closest to PaperTrail's own stack. | API-level citation contract — every RAG response carries structured citations mapping to source spans (exactly the shape our `/api/verify` response should have); their Next.js dashboard as a stack-aligned reference for our own management/monitoring UI; distinct retrieval methods (basic vs cited vs deep) as a model for our verify modes. |

---

## Clone List

Repos flagged `cloneWorthy` in the research — clone/study these directly.

- **PaperQA2** — [github.com/Future-House/paper-qa](https://github.com/Future-House/paper-qa) — **Apache-2.0** — Closest analog and gold standard for our extraction/verification half; per-chunk scored evidence + refuse-if-below-threshold is our `no_support_found` and retraction-aware metadata enrichment we should ship.
- **STORM / Co-STORM** — [github.com/stanford-oval/storm](https://github.com/stanford-oval/storm) — **MIT** — Grounded outline-then-write synthesis + multi-perspective question generation, directly usable for our meta-analysis side and evidence-network UI.
- **GPT Researcher** — [github.com/assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) — **Apache-2.0** — Parallel planner→executor→publisher pattern to fan out multi-source verification and cache; report-export pipeline for the citation-trail deliverable.
- **Open Deep Research (LangChain)** — [github.com/langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research) — **MIT** — Cleanest reference for a role-specialized model graph (cheap models for compression, strong model for verification) and a `configuration.py` Settings template.
- **txtai** — [github.com/neuml/txtai](https://github.com/neuml/txtai) — **Apache-2.0** — Reference for hybrid vector+SQL+graph retrieval in one store and GraphRAG for building our citation/evidence graph.
- **Haystack (deepset)** — [github.com/deepset-ai/haystack](https://github.com/deepset-ai/haystack) — **Apache-2.0** — Typed-component auditable pipeline mindset plus first-class RAG evaluation components for our test-set eval harness.
- **LlamaIndex** — [github.com/run-llama/llama_index](https://github.com/run-llama/llama_index) — **MIT** — `CitationQueryEngine` (sentence→source references) and LlamaExtract's schema-driven extraction mirror our flagged_spans + Zod-validation rules; LlamaParse for messy clinical-trial PDFs.
- **Aviary + LDP** — [github.com/Future-House/aviary](https://github.com/Future-House/aviary) — **Apache-2.0** — Environment/message-protocol harness to benchmark our verification pipeline reproducibly against `test-claims.json`; same lineage as PaperQA2.
- **SciPhi R2R** — [github.com/SciPhi-AI/R2R](https://github.com/SciPhi-AI/R2R) — **MIT** — API-level citation contract + a Next.js dashboard, the most stack-aligned reference for our `/api/verify` shape and management UI.

All licenses above are permissive (Apache-2.0 / MIT) — safe to study, port, or adapt.

---

## Architecture / Patterns to Adopt

Consolidated, high-leverage patterns across the clone list. Ordered by fit to PaperTrail's
deterministic-trust-layer goal.

1. **Per-chunk scored evidence with a refuse-below-threshold gate** (PaperQA2, Aviary).
   Every retrieved chunk gets a query-conditioned relevance score before it can enter an
   answer; if nothing clears the threshold, return `no_support_found`. This is the
   architectural heart of both our `flagged_spans` requirement and our honesty rule.

2. **Typed, individually-testable pipeline stages** (Haystack). Model the deterministic
   engine as an explicit retrieve → rank → filter → verify graph with Zod-validated
   inputs/outputs at each boundary. Transparent and auditable, not a black-box chain.

3. **Role-specialized model graph with a compression stage** (Open Deep Research).
   Cheap Haiku-class models for summarization/compression of many trial passages; reserve
   the strongest model for the verification-comparison step. The explicit compression
   stage bounds the evidence set before the verification agent reasons over it —
   controlling the $200 token budget.

4. **Two-stage retrieval: pgvector candidates → LLM rerank** (implied across PaperQA2 RCS
   / Undermind-style). Keep vector similarity for recall, add a Claude confirmation pass
   for precision before committing a source to a claim.

5. **Metadata-aware retrieval incl. retraction status** (PaperQA2 `DocMetadataClient`).
   Enrich cached sources with citation counts, journal quality, and retraction/editorial
   status on ingest — trust signals surfaced, not discovered late.

6. **API-level structured-citation contract** (SciPhi R2R, LlamaIndex CitationQueryEngine).
   `/api/verify` responses carry structured citations mapping to exact `raw_text` spans as
   a first-class part of the response schema.

7. **Schema-driven structured extraction** (LlamaIndex LlamaExtract). A prompt+schema
   loop that always validates output against a schema — directly parallels our
   "validate every LLM structured output against a Zod schema in `lib/schemas.ts`" rule.

8. **Parallel multi-source fan-out with caching** (GPT Researcher). Query PubMed +
   ClinicalTrials.gov + citing papers concurrently and cache all results, so the demo
   path never depends on live API latency.

9. **Multi-perspective sub-question generation + outline-then-write** (STORM/Co-STORM).
   For synthesis/meta-analysis, generate structured sub-questions (efficacy, safety,
   subgroups, risk-of-bias) and write only from retrieved sources, so every prose span
   traces to a citation.

10. **Reproducible eval environment** (Aviary + Haystack eval components). Wrap the
    verification pipeline as a benchmarkable environment scored against
    `tests/fixtures/test-claims.json` (faithfulness, citation-correctness) to catch
    regressions — satisfying the CLAUDE.md "tested, not just clicked" DoD.

11. **Hybrid vector + SQL + graph retrieval / GraphRAG** (txtai). Combine pgvector
    similarity, SQL metadata filters, and a citation-relationship graph in one retrieval
    step to power both precise verification and the evidence-graph view.

12. **Next.js management/monitoring dashboard** (SciPhi R2R-Application). A stack-aligned
    reference for a PaperTrail admin/monitoring surface over ingestion + verify jobs.
