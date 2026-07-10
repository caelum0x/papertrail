# Competitive Landscape — PaperTrail

Commercial products in the AI-research / evidence-verification / literature-synthesis
space, and what PaperTrail should borrow from each. Sourced entirely from the research
JSON — no invented products or features.

PaperTrail's wedge stays narrow: **deterministic evidence verification of clinical
efficacy claims against primary sources**, with Claude for extraction/reasoning and a
deterministic engine as the trust layer. Borrows below are filtered against that wedge —
breadth plays (writing tools, general workspaces) are explicitly deprioritized.

---

## Competitor Table

| Name | One-liner | Standout features | Notable pages / APIs |
|------|-----------|-------------------|----------------------|
| **[Elicit](https://elicit.com)** | AI research assistant over 138M+ papers that automates the full systematic-review workflow (search, screen, extract, synthesize) with PRISMA-auditable outputs. | PRISMA 2020-compliant review object (exclusion reasons, per-criterion scores, supporting quotes, auto PRISMA flow diagram); extraction into structured tables with every cell backed by a quote/figure (incl. figures); report generation across up to 200 papers with sentence-level citations; dual-review screening (2 humans + AI); shareable step-by-step process-replay links (no account needed); published accuracy benchmarks (95% recall, 96.9% screening sensitivity, 96% extraction vs 994 Cochrane reviews); "living reviews" via alerts; Search + Reports API. | Multi-step Systematic Review workflow (search→screen→extract→synthesize); extraction table UI (columns = questions, each cell sourced); Report page with methods + PRISMA flow diagram; shareable process-replay link; Search + Reports API (Pro/Enterprise); Alerts / living-review dashboard. |
| **[Consensus](https://consensus.app)** | AI search engine over 200M+ papers that synthesizes findings with citations and shows degree of scientific agreement for yes/no questions. | Consensus Meter (Yes/No/Possibly/Mixed % bar over top ~20 results); plain-language summary over top 5–10 results with source cards below; Study Snapshot "ID card" per paper (population, N, duration, geography, design, results, limitations); AI filters (sample size, population type, design, journal prestige); Pro Analysis; explicit "snapshot, read the source" uncertainty framing. | Search results page with Consensus Meter + summary box + source cards; Study Snapshot card component; AI filter panel; Pro Analysis view. |
| **[Scite.ai](https://scite.ai)** | Smart Citations engine that classifies 1.6B+ citation statements as supporting / contrasting / mentioning, powering manuscript reference-quality screening. | Smart Citations deep-learning classifier (Supporting/Contrasting/Mentioning + confidence); Reference Check (upload manuscript/reference list → flags retractions, editorial notices, high-contrasting refs); Assistant (RAG over 280M+ full-text w/ citation-backed answers); full REST API; MCP server; retraction & editorial-notice surfacing. | Embeddable Smart Citation badge on any DOI; Reference Check upload page; Assistant chat; REST API `/papers` `/tallies` `/citations` `/search` `/reference-check` `/assistant`; MCP server. |
| **[SciSpace](https://scispace.com)** | All-in-one research workspace over 280M papers: discovery, PDF reading (Copilot), data extraction, literature review, and writing with cited sources. | Copilot (highlight text / crop equations & tables in PDF → inline explanations + Q&A); Data Extractor (structured data from many papers into a comparison table); literature review over 280M papers; cited-source writing tool; Zotero/ChatGPT/Chrome integrations. | PDF reader with Copilot side panel (highlight-to-explain); literature review table builder; data extractor grid; Chrome extension; AI writer / manuscript editor. |
| **[Undermind](https://undermind.ai)** | Agentic deep-search co-researcher that recursively searches, LLM-reranks, and summarizes thousands of papers into an interactive report. | Clarification step (asks follow-ups to refine scope before searching); LLM-based relevance reranking (query + title + abstract + metadata → LLM decision, beyond BM25/cosine); recursive deep search across Semantic Scholar, PubMed, ArXiv (multi-minute runs); interactive report (ranked articles, summaries, citation networks, timelines); optimizes recall over latency. | Query + clarification chat flow; deep-search progress view; interactive report (ranked papers + summaries + citation graph + timeline). |
| **[ResearchRabbit](https://www.researchrabbit.ai)** | Free visual literature-mapping tool that builds citation/author networks from seed papers for serendipitous discovery. | Seed-paper collections that train recommendations; Similar/Earlier/Later Work navigation of the citation graph; interactive network graphs of papers & co-authors; built on Semantic Scholar + OpenAlex with NIH/S2 algorithms; fully free, collaborative collections. | Collection dashboard; paper network graph view; author network view; Similar/Earlier/Later exploration panel. |

---

## What PaperTrail Should Borrow

Grouped by theme. Each borrow ties back to an existing PaperTrail convention
(flagged_spans, discrepancy_type, deterministic engine, raw_text substring rule,
no_support_found honesty rule).

### Features

- **Consensus Meter as a first-class verification primitive** (Consensus). For a claim
  like "Drug X reduced events by 30%", show a stance meter across retrieved sources:
  supports / contradicts / partial / no-support. This is `discrepancy_type` surfaced
  visually and pairs with deterministic pooling.
- **Supporting / Contrasting / Mentioning + per-span confidence taxonomy** (Scite).
  Align our `discrepancy_type` vocabulary to this proven label set and attach a
  confidence to each flagged span.
- **Reference Check as a shippable product** (Scite). "Upload a manuscript / press
  release / slide deck → we verify every cited claim against primary sources and flag
  misrepresentations + retractions." Directly demo-ready and on-wedge.
- **Retraction / editorial-notice flagging** (Scite). Query PubMed retraction status on
  ingest and surface it in the sources cache — a trust signal, not an afterthought.
- **Study Snapshot per-source card** (Consensus). Auto-populate population, N, design,
  effect size, and stated limitations from the extraction agent so the citation trail is
  scannable.
- **Living reviews via alerts** (Elicit). Re-run a verification when new PubMed /
  ClinicalTrials.gov records appear for a tracked claim.
- **Pre-search clarification step** (Undermind). Before verifying an ambiguous claim, ask
  1–2 disambiguating questions (which drug / trial / endpoint / population) to avoid
  confidently matching the wrong source — reinforces `no_support_found`.
- **Honesty framing in copy** (Consensus). "Snapshot — read the source." Matches our
  "honest couldn't-verify > confident-wrong" rule.
- **Published accuracy benchmark** (Elicit). Publish our own numbers against
  `tests/fixtures/test-claims.json` the way Elicit publishes against Cochrane reviews.

### Pages / Screens

- **Extraction table where every cell links to a source quote** (Elicit / SciSpace).
  Our `raw_text` substring rule already enforces sourcing — surface it as a table UI with
  columns = questions, cells = sourced values.
- **Shareable process-replay link** (Elicit). Reviewer sees every retrieval → extraction
  → verification step, no account needed. A killer demo/trust feature.
- **Auto-generated PRISMA flow diagram + methods section** (Elicit) as an exportable
  artifact of the "defensible citation trail."
- **In-context PDF/source reader with hover-to-verify** (SciSpace). Render cached source
  `raw_text`; hovering a `flagged_span` shows the exact claim-vs-source comparison inline.
- **Crop-a-table/figure-to-extract interaction** (SciSpace / Elicit). Clinical effect
  sizes live in tables and figures — feed cropped regions to the extraction agent.
- **Citation-network / evidence graph view** (ResearchRabbit / Undermind). For a verified
  claim, render claim → primary source → supporting/contradicting citations.
- **Consensus results page layout** (Consensus): stance meter + summary box + source
  cards stacked, with the AI filter panel (design, population, N, journal).
- **Deep-search progress view** (Undermind) for async verify jobs.

### APIs

- **Expose the verification engine as a REST API + MCP server** (Scite). Let Claude and
  other agents call PaperTrail as a trust layer. Model the endpoints on Scite's surface:
  papers, tallies, citations, search, reference-check, assistant.
- **Structured citations in the `/api/verify` response contract** (Scite). Every response
  carries citations mapping to exact source spans — the shape our verify response should
  already have.
- **Search + Reports API** (Elicit). Programmatic access to run verifications / generate
  reports for pipeline/integration use.
- **Alerts API** (Elicit) backing living reviews.

### Architecture

- **PRISMA-auditable review object** (Elicit): exclusion reasons + per-criterion scores +
  supporting quotes as a persisted, reproducible object — maps onto flagged_spans + the
  deterministic engine.
- **Two-stage retrieval with LLM reranking** (Undermind): keep pgvector similarity for
  candidate generation, then use Claude to confirm a candidate source actually concerns
  the claimed trial/endpoint before committing — raises precision, reinforces
  `no_support_found`.
- **Separate stance classifier over top-K results** (Consensus): a dedicated
  supports/contradicts/partial pass, distinct from summarization.
- **Accept longer runtime for higher recall on async jobs** (Undermind) — fine for verify
  jobs, but keep the demo path cached (per CLAUDE.md's "demo must not depend on live
  latency").

**Explicitly do NOT borrow** (scope creep against the verification wedge): SciSpace's
general writing tool / end-to-end workspace breadth. Chase depth on verification, not
breadth.

---

## Prioritized Feature Backlog for PaperTrail

Ordered roughly by demo/trust impact vs effort. Each item tagged
`[page]` / `[api]` / `[feature]` / `[architecture]`.

### P0 — Demo-critical trust & clarity

- `[feature]` **Stance meter** across retrieved sources (supports / contradicts / partial
  / no-support) driven by `discrepancy_type`. *(Consensus)*
- `[page]` **Sourced extraction table** — columns = questions, every cell links to an
  exact `raw_text` substring. *(Elicit / SciSpace)*
- `[page]` **Shareable process-replay link** — full retrieval→extraction→verification
  trail, no account. *(Elicit)*
- `[feature]` **Per-span confidence + Supporting/Contrasting/Mentioning taxonomy** aligned
  to `discrepancy_type`. *(Scite)*
- `[api]` **`/api/verify` structured-citation contract** — every response carries
  citations mapping to source spans. *(Scite)*
- `[feature]` **Retraction / editorial-notice flagging** on source ingest via PubMed
  retraction status. *(Scite)*

### P1 — Precision & honesty hardening

- `[architecture]` **LLM reranking on top of pgvector** in `retrievalAgent.ts` — Claude
  confirms the candidate source concerns the claimed trial/endpoint. *(Undermind)*
- `[feature]` **Pre-verify clarification step** — 1–2 disambiguating questions on
  ambiguous claims. *(Undermind)*
- `[page]` **Study Snapshot source card** (population, N, design, effect size,
  limitations) auto-filled by the extraction agent. *(Consensus)*
- `[page]` **In-context source reader with hover-to-verify** flagged spans. *(SciSpace)*
- `[architecture]` **Dedicated stance-classifier pass** distinct from summarization.
  *(Consensus)*

### P2 — Shippable adjacent product & artifacts

- `[feature]` **Reference Check** — upload manuscript / press release / slide deck, verify
  every cited claim, flag misrepresentations + retractions. *(Scite)*
- `[page]` **PRISMA flow diagram + methods section** exportable artifact. *(Elicit)*
- `[feature]` **Crop-a-table/figure-to-extract** for effect sizes in tables/figures.
  *(SciSpace / Elicit)*
- `[architecture]` **PRISMA-auditable review object** persisted with exclusion reasons +
  per-criterion scores + quotes. *(Elicit)*

### P3 — Scale, integrations & living evidence

- `[api]` **REST API + MCP server** exposing the verification engine as a trust layer for
  Claude/other agents. *(Scite)*
- `[feature]` **Living reviews via alerts** — re-verify tracked claims when new
  PubMed/CT.gov records appear. *(Elicit)*
- `[page]` **Citation-network / evidence-graph view** — claim → primary source →
  supporting/contradicting citations. *(ResearchRabbit / Undermind)*
- `[page]` **Deep-search progress view** for async verify jobs. *(Undermind)*
- `[feature]` **Published accuracy benchmark** against `tests/fixtures/test-claims.json`.
  *(Elicit)*
- `[api]` **Search + Reports + Alerts APIs** for programmatic pipeline use. *(Elicit)*
