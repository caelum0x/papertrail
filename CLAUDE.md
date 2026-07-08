# CLAUDE.md

This file gives Claude Code the context it needs to work in this repo without
re-deriving decisions already made. Read this before making architectural changes.

## Project

PaperTrail — a provenance/verification agent for clinical trial efficacy claims.
Given a claim (e.g. "Drug X reduced events by 30%"), it finds the primary source
(PubMed/ClinicalTrials.gov), extracts the actual finding, and flags discrepancies
between the claim and the source with a trust score and citation trail.

Full spec: `PRD.md`. Full architecture: `ARCHITECTURE.md`.

## Hackathon Context

Built for "Built with Claude: Life Sciences" (Anthropic × Gladstone Institutes),
July 7–13, 2026. Solo builder, Build track. Judges include Anthropic and Gladstone
staff — demo should target a translational-research audience (disease-focused labs),
not generic biotech PR. Deadline is real — favor shipping a narrow, fully-working
tool over a broad, partially-working one.

## Tech Stack (do not deviate without discussion)

- Next.js 14 App Router, TypeScript, Tailwind
- Postgres + pgvector on Neon
- Claude API (Anthropic SDK) for extraction/verification reasoning
- Embeddings: see `lib/embeddings.ts` for current provider
- Deployed on Vercel

## Commands

```bash
npm install
npm run dev              # local dev server
npm run db:migrate       # apply schema in ARCHITECTURE.md
npm run ingest:test-set  # pre-load demo sources (scripts/ingest-test-set.ts)
npm test                 # run tests/*.test.ts against tests/fixtures/test-claims.json
```

## Conventions

- All LLM structured outputs MUST be validated against a Zod schema in `lib/schemas.ts`
  before being used. Never trust raw JSON.parse of an LLM response without validation.
- Every verification result must include `flagged_spans` that map back to an exact
  substring of the cached source `raw_text` — no unsourced claims about the source.
- If retrieval finds no confident match (similarity below threshold — see
  `lib/agents/retrievalAgent.ts`), return `discrepancy_type: 'no_support_found'`
  rather than forcing a low-confidence match. A wrong "confident" answer is worse
  than an honest "couldn't verify."
- Cache everything fetched from PubMed/ClinicalTrials.gov in `sources` table —
  never re-fetch on every request; the demo must not depend on live API latency.
- Env vars go in `.env.local`, documented in `.env.example`. Never commit real keys.

## Current Priorities (update as the week progresses)

1. Data ingestion + caching (`lib/sources/*`, `lib/db.ts`)
2. Retrieval agent (semantic search)
3. Extraction agent (structured finding extraction)
4. Verification agent (comparison + scoring) — most important, most iteration
5. UI
6. Test-set validation against `tests/fixtures/test-claims.json`
7. Demo prep — lock 2 examples (one clear catch, one confirmed-accurate) by Day 6

## Production Definition of Done (not just "it worked when I clicked it")

Before considering the tool demo-ready, verify:
- [ ] Every agent call has a try/catch with a user-visible fallback state
- [ ] `/api/verify` is rate-limited (see ARCHITECTURE.md §Production Hardening)
- [ ] `/api/health` exists and returns a real status
- [ ] No claim text or API keys appear in logs
- [ ] `.env.example` is current and `.env.local` is git-ignored
- [ ] README lets a stranger run this without asking you anything
- [ ] CI passes on the latest commit before the demo
- [ ] Tested with the deployed Vercel URL, not just localhost

If a change doesn't move one of these checkboxes or improve Section 5 of
`PRD.md`, it's scope creep this week — defer it to "Future Work."

## Known Constraints

- $200 API credits total — be mindful of token usage; cache aggressively, avoid
  re-running full chains during manual testing when a cached result would do.
- Solo builder — Claude Code should default to complete, working increments rather
  than leaving TODOs; there's no second person to pick up loose ends.
