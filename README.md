# PaperTrail

**The evidence-verification and provenance platform for regulated life-sciences work.**

PaperTrail is a multi-tenant enterprise system where pharma medical-affairs, HEOR,
regulatory and medical-writing teams, systematic-review groups, CROs, pharmacovigilance
units, and academic labs verify scientific and efficacy claims against primary sources —
ingesting and mining their own document corpora, running auditable agentic research
workflows, and producing a defensible provenance trail for every cited number.

At its center is a differentiator no other claim-checker has: a **deterministic
verification engine** that checks a claim against a trial's *own registered statistical
results* — with **no LLM in the numeric loop**.

## The moat: deterministic verification, not vibes

Generic claim verifiers (Valsci, Loki, MiniCheck, the SciFact/MultiVerS lineage) stop at
LLM judgment or textual entailment over prose and abstracts — they assess whether the
literature *agrees* with a claim. PaperTrail independently **recomputes the number the
trial actually registered**:

- **Structured registry verification** (`lib/structuredVerification.ts`) — parses
  ClinicalTrials.gov's structured `resultsSection`: registered outcome analyses
  (`paramType`/`paramValue`/CI/p-value) *and* raw per-arm event counts.
- **Biostatistics recomputed from raw counts** (`lib/biostats.ts`) — absolute risk
  reduction, NNT, and risk ratio + 95% CI (log-RR delta method; quantile from
  `simple-statistics`), oracle-tested against epitools/OpenEpi reference values.
- **Endpoint-switch detection** — flags a claim whose magnitude matches a *secondary*
  outcome, not the trial's primary result.
- **Code-enforced exact-span grounding** (`lib/grounding.ts`) — every flagged span is a
  verbatim substring of the cached source; any span the model can't locate is *dropped*.
  PaperTrail structurally cannot make an unsourced claim about a source.
- **Multi-source cross-verification** — corroborated / conflicting / single-source, with a
  deterministic trust-score adjustment.

> Example, live from SPRINT's registry: a claim of *"cut cardiovascular risk in half"* is
> flagged **overstates_registry** — the registered primary result is HR 0.75 (95% CI
> 0.64–0.89), a ~25% reduction; raw counts give ARR 1.6 points, NNT 62. No LLM produced
> that number.

## Platform

Multi-tenant (orgs, memberships, RBAC), with a `/console` application and a public
marketing/trust surface. Major module areas:

| Area | Capabilities |
|---|---|
| **Verification core** | Claims, single + batch verification, registry/effect-size/grounding engine, evidence library, sources |
| **Documents at scale** | Bulk PDF ingestion & extraction (in-process `unpdf`, MIT; Docling, MIT, via direct subprocess), per-page + chunked storage, candidate-claim extraction from full papers |
| **Research** | Agentic workflow engine (composable pipelines + run traces), Claude Science workbench connector, systematic review / PRISMA screening, agent evaluation, pharmacovigilance monitoring, publication planning / MLR |
| **Collaboration** | Comments, annotations, activity feeds, review & approval workflows, reference/citation manager (BibTeX/RIS) |
| **Platform & governance** | SSO-ready auth, fine-grained RBAC, immutable hash-chained audit trail + e-signatures (21 CFR Part 11-style), background jobs & schedules, billing & usage metering, public API + webhooks + MCP tool registry, notifications, global search, analytics dashboards, integrations |

The full module/page/API map lives in [`docs/enterprise-architecture.md`](docs/enterprise-architecture.md).

## Tech

- **Next.js 14** (App Router, TypeScript strict), **Tailwind**
- **Postgres + pgvector** (Neon), migrations under `db/migrations/` applied in order
- **Anthropic Claude** (extraction, verification, agentic workflows), **Voyage** embeddings
- **Auth**: `jose` (HS256 session JWT) + `bcryptjs`, org-scoped API contract (`lib/api/*`)
- **Merged OSS**: `unpdf` (MIT, in-process PDF), Docling (MIT, polyglot subprocess),
  `fast-xml-parser` (PubMed XML), `simple-statistics` (biostatistics)

## Quickstart

**Prerequisites:** Node 20+, a Postgres/pgvector database (e.g. [Neon](https://neon.tech)),
an [Anthropic](https://console.anthropic.com) key, a [Voyage](https://voyageai.com) key.

```bash
cp .env.example .env.local     # fill in real values
npm install
npm run db:migrate             # applies db/migrations.sql then db/migrations/*.sql in order
npm run dev                    # http://localhost:3000  →  register at /register, app at /console
```

Optional for the document AI path: `DOCLING_ENABLED=true` plus
`pip install -r python/requirements.txt` (Docling is MIT; falls back to in-process `unpdf`).

**Verify the build:**

```bash
npx tsc --noEmit      # type-check
npm test              # unit + component tests (live-API tests skip without ANTHROPIC_API_KEY)
npm run build         # production build
npm run eval          # accuracy eval vs pinned labeled fixtures (needs DB + keys)
```

## Key environment variables

Documented in full in `.env.example`. Highlights: `DATABASE_URL`, `AUTH_SECRET`,
`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `DEMO_MODE` (cache-only retrieval),
`DOCLING_ENABLED` (structured PDF extraction).

## Documentation

- [`docs/enterprise-architecture.md`](docs/enterprise-architecture.md) — module / page / API blueprint
- [`docs/oss-analysis.md`](docs/oss-analysis.md) — OSS alternatives & adopted libraries
- `PRD.md` — product requirements · `ARCHITECTURE.md` — technical design · `CLAUDE.md` — conventions

## License

MIT — see `LICENSE`. Not affiliated with any other product named "PaperTrail".
