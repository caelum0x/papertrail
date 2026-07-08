# PaperTrail — Full Application Architecture (v1.1 scope)

Supersedes the narrow single-page MVP in `ARCHITECTURE.md` §Folder Structure.
Same three agents, same core pipeline — this expands the surface area around
them. Read this alongside `PRD.md` §10 (production, not scope creep): every
addition below either (a) reuses the existing pipeline against new inputs, or
(b) reads/displays data the pipeline already writes. Nothing here introduces a
new kind of reasoning the agents don't already do.

## Why this scope is safe to build (not bloat)

| New surface | What it actually does |
|---|---|
| `/batch`, `/api/verify/batch` | Calls the existing `retrieveSource → extractFinding → verifyClaim` chain N times, concurrency-capped. No new agent logic. |
| `/recent`, `/dashboard`, `/v/[id]`, their APIs | Read the `verifications` table the pipeline already writes to. Pure display layer. |
| `/sources`, `/api/sources` | Read the `sources` table already populated by ingestion. Pure display layer. |
| `/eval` | Runs `tests/fixtures/test-claims.json` through the existing `/api/verify` endpoint and tabulates results. No new logic — it's the test suite, visualized. |
| `/about`, `/api-docs`, `/status` | Static content + a friendly wrapper around `/api/health`. No logic at all. |

If at any point a "page" idea requires new agent reasoning beyond these five
patterns, that's the signal to stop and treat it as a separate scope decision,
not just another item on the list.

## Full Folder Tree

```
papertrail/
├── PRD.md · ARCHITECTURE.md · ARCHITECTURE_FULL.md (this file) · CLAUDE.md · AGENTS.md · README.md · LICENSE
├── .env.example
├── package.json · tsconfig.json · next.config.js · tailwind.config.ts · postcss.config.js · vitest.config.ts
├── middleware.ts · next-env.d.ts
│
├── app/
│   ├── layout.tsx                    # root layout, wraps <Nav/> + <Footer/>
│   ├── globals.css
│   ├── error.tsx                     # global error boundary (catches unhandled render errors)
│   ├── not-found.tsx                 # global 404
│   ├── loading.tsx                   # global loading fallback
│   ├── robots.ts                     # GET /robots.txt
│   ├── sitemap.ts                    # GET /sitemap.xml
│   │
│   ├── page.tsx                      # / — hero + pipeline explainer + single-claim verify [EXISTS]
│   │
│   ├── batch/
│   │   ├── page.tsx                  # /batch — paste N claims, submit, see per-claim results
│   │   └── loading.tsx
│   │
│   ├── sources/
│   │   ├── page.tsx                  # /sources — browse/search cached PubMed + ClinicalTrials.gov records
│   │   └── loading.tsx
│   │
│   ├── recent/
│   │   ├── page.tsx                  # /recent — feed of recent verifications, paginated
│   │   └── loading.tsx
│   │
│   ├── dashboard/
│   │   ├── page.tsx                  # /dashboard — aggregate stats (counts by discrepancy_type, avg trust score)
│   │   └── loading.tsx
│   │
│   ├── eval/
│   │   ├── page.tsx                  # /eval — runs test-claims.json live, shows expected vs actual
│   │   └── loading.tsx
│   │
│   ├── about/
│   │   └── page.tsx                  # /about — problem, named user, architecture summary (static)
│   │
│   ├── api-docs/
│   │   └── page.tsx                  # /api-docs — reference for the 7 endpoints (static, generated from lib/apiSpec.ts)
│   │
│   ├── status/
│   │   ├── page.tsx                  # /status — human-readable wrapper around /api/health
│   │   └── loading.tsx
│   │
│   ├── v/[id]/
│   │   ├── page.tsx                  # /v/[id] — permalink for a single verification result (shareable)
│   │   ├── not-found.tsx             # invalid/missing id
│   │   └── loading.tsx
│   │
│   └── api/
│       ├── verify/route.ts                  # POST — single claim [EXISTS]
│       ├── verify/batch/route.ts            # POST — array of claims → batch job
│       ├── verifications/route.ts           # GET — paginated list, ?discrepancy_type= filter
│       ├── verifications/[id]/route.ts      # GET — single verification detail
│       ├── sources/route.ts                 # GET — paginated list/search
│       ├── stats/route.ts                   # GET — aggregate counts
│       └── health/route.ts                  # GET [EXISTS]
│
├── lib/
│   ├── db.ts · embeddings.ts · claude.ts · schemas.ts · logger.ts · rateLimit.ts        [EXIST]
│   ├── sources/{pubmed.ts, clinicaltrials.ts}                                            [EXIST]
│   ├── agents/{retrievalAgent.ts, extractionAgent.ts, verificationAgent.ts}              [EXIST]
│   ├── agents/
│   │   └── batchAgent.ts             # orchestrates concurrency-capped runs of the existing 3-agent chain
│   ├── queries/                      # centralizes SQL for the new read endpoints — keeps route handlers thin
│   │   ├── verifications.ts          # listVerifications(), getVerificationById()
│   │   ├── sources.ts                # listSources(), searchSources()
│   │   └── stats.ts                  # getAggregateStats()
│   ├── apiSpec.ts                    # single source of truth for /api-docs content (endpoint, method, schema)
│   └── seo.ts                        # shared metadata() helper for consistent SEO tags per page
│
├── components/
│   ├── ClaimInput.tsx · SourceMatch.tsx · TrustScoreCard.tsx · CitationTrail.tsx  [EXIST]
│   ├── Nav.tsx                       # top nav linking all 10 pages
│   ├── Footer.tsx                    # links, license, repo link
│   ├── BatchClaimInput.tsx           # multi-line/CSV claim input for /batch
│   ├── BatchResultsTable.tsx
│   ├── VerificationCard.tsx          # shared summary card — used in /recent, /dashboard, /v/[id]
│   ├── SourceCard.tsx
│   ├── StatsSummary.tsx
│   ├── EvalTable.tsx                 # expected vs actual comparison table for /eval
│   ├── StatusIndicator.tsx
│   └── Pagination.tsx
│
├── scripts/{migrate.ts, seed-db.ts, ingest-test-set.ts}   [EXIST]
├── db/migrations.sql                                       [UPDATED — see below]
│
├── tests/
│   ├── fixtures/test-claims.json                           [EXISTS]
│   ├── schemas.test.ts · rateLimit.test.ts                 [EXIST — pure logic]
│   ├── extraction.test.ts · verification.test.ts           [EXIST — skip w/o API key]
│   ├── lib/queries/
│   │   ├── verifications.test.ts
│   │   ├── sources.test.ts
│   │   └── stats.test.ts
│   ├── api/
│   │   ├── verify.route.test.ts
│   │   ├── verify.batch.route.test.ts
│   │   ├── verifications.route.test.ts
│   │   ├── verifications.id.route.test.ts
│   │   ├── sources.route.test.ts
│   │   ├── stats.route.test.ts
│   │   └── health.route.test.ts
│   └── components/
│       ├── ClaimInput.test.tsx · TrustScoreCard.test.tsx · CitationTrail.test.tsx
│       ├── BatchResultsTable.test.tsx · VerificationCard.test.tsx · SourceCard.test.tsx
│       └── StatsSummary.test.tsx · EvalTable.test.tsx
│
├── docs/demo-script.md                                     [EXISTS]
└── .github/workflows/ci.yml                                [EXISTS]
```

## Schema Additions (already applied to `db/migrations.sql`)

```sql
create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  claim_count int not null,
  status text not null default 'processing' check (status in ('processing', 'complete', 'failed')),
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- verifications.batch_id uuid references batches(id) on delete set null  (nullable — single verifies have no batch)
-- + indexes on verifications(created_at desc) and verifications(batch_id) for the list/feed queries
```

No new tables needed for `/sources`, `/dashboard`, `/eval` — they read `sources`
and `verifications` directly.

## API Contracts

| Endpoint | Method | Request | Response (200) |
|---|---|---|---|
| `/api/verify` | POST | `{ claim: string }` | `{ status, source, finding, verification }` [EXISTS] |
| `/api/verify/batch` | POST | `{ claims: string[] }` (max 20) | `{ batch_id, results: VerifyResult[] }` |
| `/api/verifications` | GET | `?limit=&offset=&discrepancy_type=` | `{ items: Verification[], total: number }` |
| `/api/verifications/[id]` | GET | — | `Verification` or 404 |
| `/api/sources` | GET | `?limit=&offset=&q=` | `{ items: Source[], total: number }` |
| `/api/stats` | GET | — | `{ total_verifications, by_discrepancy_type: {...}, avg_trust_score, total_sources }` |
| `/api/health` | GET | — | `{ status, checks, timestamp }` [EXISTS] |

## Test Plan (how ~90 tests happens honestly, not by padding)

| Category | Count | What it actually checks |
|---|---|---|
| Schemas (`schemas.test.ts`) | ~10 | Zod validation for all request/response shapes, incl. new batch/list schemas |
| Rate limiter | 3 | Existing |
| Live-agent tests (extraction/verification) | ~10 | One case per discrepancy_type — skipped without `ANTHROPIC_API_KEY`, run locally before demo |
| Query layer (`lib/queries/*`) | ~15 | List/filter/pagination logic against a test DB, incl. edge cases (empty results, invalid id) |
| API routes (7 endpoints) | ~35 | Per endpoint: validation errors, happy path (mocked agents), rate limit / 404 / 500 handling |
| Components | ~28 | Render + interaction tests per component (React Testing Library) |
| **Total** | **~100** | Falls out of testing each real endpoint and component properly — not a target chased for its own sake |

## Revised Day-by-Day (today = Day 1, deadline Jul 13)

- **Day 1 (today):** Core pipeline + `/`, `/api/verify`, `/api/health` — already built and build-verified. Add `batches` table (done above).
- **Day 2:** `lib/queries/*`, remaining 5 API routes, `lib/agents/batchAgent.ts`
- **Day 3:** `/batch`, `/recent`, `/dashboard`, `/sources`, `/v/[id]` pages + shared components (`Nav`, `Footer`, `VerificationCard`, etc.)
- **Day 4:** `/eval`, `/about`, `/api-docs`, `/status` + SEO/robots/sitemap + error/loading/not-found states
- **Day 5:** Test suite build-out across all categories above
- **Day 6:** Demo prep — lock `docs/demo-script.md` examples, deploy hardening pass, run through PRD §10 checklist
- **Day 7:** Buffer + submission

## What's explicitly still out of scope

Multi-claim types beyond clinical trial efficacy, auth/multi-tenancy, real-time
monitoring/alerts. See `PRD.md` §4. Growing page/API surface area does not
reopen this — it's still the same claim type, same three agents, more views
onto the same data.
