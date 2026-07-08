# PaperTrail — Architecture

## Stack

- **Frontend/API:** Next.js 14 (App Router), TypeScript, Tailwind
- **DB:** Postgres on Neon with pgvector extension
- **Agent orchestration:** LangChain (JS) or direct Claude API calls with structured
  output (Zod validation) — prefer direct API calls over LangChain unless multi-step
  chaining genuinely needs it; less abstraction = easier to debug in a week.
- **Embeddings:** Voyage AI or OpenAI text-embedding-3 (whichever is fastest to wire up
  with your existing credits) for semantic search over source abstracts/full text.
- **LLM reasoning:** Claude (Sonnet, via API) for extraction + comparison steps.
- **Deployment:** Vercel (frontend/API routes) + Neon (managed Postgres) — both have
  zero-config paths from a Next.js repo, minimizing hackathon setup time.
- **External data:** PubMed E-utilities API, ClinicalTrials.gov API v2.

## System Flow

```
User claim (text)
      │
      ▼
[1] Retrieval Agent
    - embeds claim
    - pgvector similarity search over cached source records
    - if no good local match, live-query PubMed/ClinicalTrials.gov,
      ingest + embed + cache result
      │
      ▼
[2] Extraction Agent
    - given matched source (abstract/results text), extract structured finding:
      { effect_size, population, condition, endpoint, caveats[] }
    - Zod-validated JSON output from Claude
      │
      ▼
[3] Verification Agent
    - compares claim text vs. extracted finding
    - outputs: { discrepancy_type, trust_score, explanation, flagged_spans[] }
      │
      ▼
[4] UI renders: claim | source passage | flags | score | citation link
```

## Data Model (Postgres)

```sql
-- cached source records
create table sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,        -- 'pubmed' | 'clinicaltrials'
  external_id text not null,        -- PMID or NCT number
  title text,
  raw_text text not null,           -- abstract or results section
  embedding vector(1024),           -- Voyage voyage-3 dimensionality
  fetched_at timestamptz default now(),
  unique(source_type, external_id)
);

-- extracted structured findings (cached per source, reusable across claims)
create table findings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id),
  effect_size text,
  population text,
  condition text,
  endpoint text,
  caveats jsonb,
  extracted_at timestamptz default now()
);

-- verification runs (one per user claim submission)
create table verifications (
  id uuid primary key default gen_random_uuid(),
  claim_text text not null,
  matched_source_id uuid references sources(id),
  discrepancy_type text,            -- 'accurate' | 'magnitude_overstated' | ...
  trust_score int,
  explanation text,
  flagged_spans jsonb,
  created_at timestamptz default now()
);
```

## Folder Structure

```
papertrail/
├── PRD.md
├── ARCHITECTURE.md
├── CLAUDE.md
├── AGENTS.md
├── README.md
├── .env.example
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
│
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # main claim input + results UI
│   ├── globals.css
│   └── api/
│       ├── verify/route.ts         # orchestrates all 3 agents (retrieve→extract→verify)
│       └── health/route.ts         # DB + API-key status for uptime checks
│
├── lib/
│   ├── db.ts                       # Neon/pg client
│   ├── embeddings.ts                # embed(text) -> vector
│   ├── claude.ts                    # Claude API wrapper, shared config
│   ├── schemas.ts                   # Zod schemas for structured outputs
│   ├── sources/
│   │   ├── pubmed.ts                # PubMed E-utilities client
│   │   └── clinicaltrials.ts        # ClinicalTrials.gov API client
│   └── agents/
│       ├── retrievalAgent.ts
│       ├── extractionAgent.ts
│       └── verificationAgent.ts
│
├── components/
│   ├── ClaimInput.tsx
│   ├── SourceMatch.tsx
│   ├── TrustScoreCard.tsx
│   └── CitationTrail.tsx
│
├── scripts/
│   ├── ingest-test-set.ts           # pre-load 10-20 hand-picked trials for demo
│   └── seed-db.ts
│
├── tests/
│   ├── fixtures/
│   │   └── test-claims.json         # your hand-built ground-truth claim/source pairs
│   ├── extraction.test.ts
│   └── verification.test.ts
│
└── docs/
    └── demo-script.md               # locked demo examples + talking points
```

## Production Hardening (applies to the same V1 scope, not new features)

- **Rate limiting:** `middleware.ts` throttles `/api/verify` per IP (e.g. 10
  requests/10 min). Use Vercel Edge Config or a simple in-memory + Neon-backed
  counter — no need for Redis at this scale.
- **NCBI API key:** register one for PubMed E-utilities — unauthenticated requests
  are capped at 3/sec, keyed requests get 10/sec. Cheap insurance against rate
  limiting during a live demo. Include `User-Agent` header on all outbound
  requests per NCBI's usage policy.
- **Health check:** `app/api/health/route.ts` — returns DB connectivity + API key
  presence status. Lets you (or a judge) verify the deployment is alive without
  running the full claim flow.
- **Structured logging:** wrap agent calls with a `lib/logger.ts` that logs
  request id, latency, and outcome (not full claim text, to avoid logging
  sensitive/unpublished research text). Use `console.log` with structured JSON —
  Vercel captures this automatically, no need for a third-party service this week.
- **Graceful degradation states in UI:**
  - No confident source match → "Couldn't verify against a primary source" (not
    a forced guess)
  - API timeout → "This is taking longer than expected, retry" (not a blank page)
  - Rate limited → clear message, not a silent 429
- **CI:** `.github/workflows/ci.yml` runs `npm run build` + `npm test` on every
  push. Signals engineering discipline to anyone (including judges) who checks
  the repo, and catches breakage before it reaches the deployed demo URL.
- **LICENSE:** add an MIT or Apache-2.0 license file. Gladstone/Anthropic both
  favor reproducible, adoptable tools — an unlicensed repo reads as "toy," a
  licensed one reads as "meant to be used."
- **Secrets hygiene:** confirm `.env.local` is git-ignored, confirm no API keys
  are logged anywhere, confirm the deployed Vercel env vars (not the repo) hold
  the real credentials.

## Build Order (maps to Day 1–7 plan)

1. `lib/sources/*` + `lib/db.ts` + schema migration — get real data flowing
2. `lib/embeddings.ts` + retrieval agent — semantic search working
3. `lib/agents/extractionAgent.ts` + `lib/schemas.ts` — structured extraction
4. `lib/agents/verificationAgent.ts` — the core comparison logic (most iteration time)
5. `app/page.tsx` + components — UI wiring
6. `tests/fixtures/test-claims.json` — build this **early**, in parallel with step 1,
   so every later step has ground truth to validate against
7. `scripts/ingest-test-set.ts` — pre-warm the DB with demo-relevant sources so the
   live demo doesn't depend on live API latency
