# AGENTS.md

Repo-level instructions for any coding agent working in this project (Claude Code
or otherwise). This complements `CLAUDE.md`, which has PaperTrail-specific project
context; this file covers general repo hygiene.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in real keys, never commit .env.local
npm run db:migrate
```

## Build / Test / Run

```bash
npm run dev          # dev server, http://localhost:3000
npm run build         # production build — must pass before any deploy
npm test              # runs tests/*.test.ts
npm run lint           # eslint + typecheck
```

Run `npm test` and `npm run build` before considering any feature "done." A feature
that doesn't build is not shippable, even under hackathon time pressure.

## Code Style

- TypeScript strict mode — no `any` without a comment explaining why.
- Prefer small, single-purpose functions in `lib/` over logic embedded in route
  handlers or components.
- Structured LLM outputs always go through a Zod schema (`lib/schemas.ts`) — see
  `CLAUDE.md` for why.
- Keep API route handlers thin — they call into `lib/agents/*`, they don't contain
  business logic themselves.

## Directory Ownership

- `lib/agents/` — the three core agents (retrieval, extraction, verification).
  This is the highest-value code in the repo; changes here should be tested
  against `tests/fixtures/test-claims.json` before merging.
- `lib/sources/` — external API clients. Keep these isolated so a schema change
  in PubMed's API doesn't ripple into agent logic.
- `app/` — UI and API routes only, no business logic.
- `scripts/` — one-off/setup scripts, not part of the running app.

## Commit Conventions

- Small, working commits over large batched ones — solo builder, one week, needs
  to be able to roll back a bad change without losing everything since.
- Commit message format: `[area] short description` — e.g. `[retrieval] add
  pgvector similarity threshold`.

## Definition of Done (per feature)

1. Builds (`npm run build` passes)
2. Passes existing tests, and has a new test if it's agent logic
3. Manually verified against at least one real (not synthetic) example
4. Deployed to the Vercel preview URL and checked there, not just localhost
5. Fails gracefully — no unhandled exception reaches the UI as a raw error
6. Doesn't widen scope beyond `PRD.md` Section 5 — see Section 10 of PRD for why
   "production" means hardening this scope, not adding to it

## CI

`.github/workflows/ci.yml` runs `npm run build` and `npm test` on every push to
`main`. A red CI badge before the demo is a real problem — check it the morning
of judging, not the moment before you present.

## Do Not

- Do not add authentication/multi-tenancy in V1 — out of scope per `PRD.md`.
- Do not add a new external dependency without checking it doesn't blow past the
  $200 API credit budget (embedding/LLM API costs, not npm packages).
- Do not leave TODOs in agent logic (`lib/agents/*`) — either finish it or cut the
  feature per `PRD.md` Section 8/9.
