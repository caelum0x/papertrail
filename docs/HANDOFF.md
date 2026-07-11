# PaperTrail — Session Handoff (for the next model / session)

Written 2026-07-11. Read this + `CLAUDE.md` + `docs/benchmark-clinical.md` before continuing.

## What PaperTrail is
Provenance/evidence-verification platform for regulated life-sciences. Core: verify a clinical
efficacy/safety claim against its primary source, flag distortions (magnitude / population /
caveat), return a grounded verdict + trust score + citation trail. **Moat: NO LLM in any
numeric/verdict/scoring path** — deterministic math decides; Claude only for grounded language
steps, routing hints, and narrative. Stack: Next.js 16 App Router, TS strict, Postgres/pgvector on
Neon, Anthropic `claude-*`, Vercel. Deploy via `vercel --prod --yes` (CLI upload).

## Two things being built this session
### 1) Mixture of Agents (MoA) — a "deep verify" composing all backend engines
- `lib/moa/*`: `types.ts` (contract: agents declare `produces`/`consumes` typed artifacts + optional
  `authority`), `blackboard.ts` (typed shared memory), `scheduler.ts` (topological layering →
  real composition), `router.ts` + `planner.ts` (gate + Claude planner), `aggregate.ts`
  (deterministic mix + **lead-verifier deference**), `synthesize.ts`, `orchestrate.ts`,
  `registry.ts`, `agents/*` (23 agents incl. the flagship `discrepancy` auditor).
- Routes: `/api/moa/orchestrate` (paste sources), `/api/moa/verify-claim` (claim → retrieve →
  MoA). UI: `/console/orchestrator` (visualizes the layered DAG + artifact provenance).
- **Key design (aggregate.ts):** on a SINGLE-source claim, DEFER to the highest-`authority`
  verification agent that ran (the `discrepancy` auditor, authority 3) — the mixture *inherits* its
  accuracy instead of diluting it. On ≥2 sources (cross-source consensus) OR when the LLM lead
  couldn't run, use the full deterministic mix. `orchestrate` passes `sourceCount` to gate this.

### 2) Builder Track — 3 named-user tools (the actual hackathon deliverable)
"Built Beyond the Bench": a named user runs the tool without the builder, built to outlast the week.
- **Lab Notebook** (wet-lab scientist) — `/console/lab-notebook`: notes → structured record,
  grounded vs auto-inferred badges, JSON/MD export.
- **Trial Matcher** (research coordinator) — `/console/trial-matcher`: vignette → ranked
  ClinicalTrials.gov trials with per-criterion inclusion/exclusion reasoning + honest "unknown".
- **Claim Verification** (medical-affairs) — `/console/verify`: claim → verdict + trust + flagged
  claim-vs-source spans. Uses `/api/verify/text` (returns the object DIRECTLY, no envelope).
Each has a one-click example + honest degraded state (no white-screen if the API key is capped).

## HONEST benchmark truth (I over-claimed twice earlier — corrected)
On the 20-case single-source clinical set (`tests/fixtures/clinical-efficacy.json`), healthy API:
- **PaperTrail (deterministic + audit path): 95%**, **Claude-alone: 90%** — reproducible.
- **MoA: 90–95% across runs (LLM variance)** — it *defers* to the discrepancy auditor, so it TRACKS
  the PaperTrail path; it does NOT "crush" Claude. One run 95%, another 90% (=Claude).
Multi-source (`tests/fixtures/clinical-multisource.json`, 8 cases): **MoA 100% = Claude 100%**
(composition ties; deference correctly does NOT fire — confirmed after the source-count fix).
Resilience (API down mid-campaign, a real event): MoA **80–85%** on deterministic agents alone vs
Claude-alone / pure-LLM **10%** — the deterministic floor a single-LLM approach lacks.
**Durable claim:** the deterministic reconcile + grounding ties-to-beats a plain LLM (90–95% vs 90%)
and adds resilience — NOT "the mixture is far more accurate." Keep claims honest.

Run benchmarks: `MOA_ENABLED=true DOTENV_CONFIG_PATH=.env.vercel.local npx tsx scripts/benchmark/run.ts --clinical`
and `... npx tsx scripts/benchmark/multisource.ts`. Pull env first: `vercel env pull .env.vercel.local --environment=production --yes` (DELETE it after — it holds secrets; it's git-ignored).

## Git state
- Last commit on `main`: **7bf0e2d** (deference single-source + authority no longer amplifies mix). Pushed.
- **UNCOMMITTED (in progress): the `builder-track-deepen` workflow (`wqfqbcl66`) is STILL RUNNING**
  as of handoff and is editing tool files. New/modified (not yet committed):
  - modified: `app/console/lab-notebook/_components/{Capture,StructuredRecord,exportRecord,types}.tsx/ts`,
    `app/console/trial-matcher/_components/{MatchResults,api}.tsx/ts`, `app/console/verify/page.tsx`,
    `docs/benchmark-multisource.md` (now shows the recovered 100%)
  - new: `app/console/demo/` (reviewer walkthrough landing), `lib/labNotebook/reproducibility.ts` +
    `_components/ReproducibilityHints.tsx`, `lib/trialMatcher/rankSummary.ts`,
    `app/console/verify/_components/{MixturePanel,moaTypes,provenance}.ts(x)`.

## IMMEDIATE NEXT STEPS (do these when the deepen workflow finishes)
1. Check the deepen workflow result: read its verify-phase issues (blocking ones first).
2. `npx tsc --noEmit` (expect 0) and `npm run build` (expect green). Fix any errors.
3. Add a nav link for the new `/console/demo` page in `app/console/layout.tsx` (single-writer file;
   add `{ href: "/console/demo", label: "Start / Reviewer demo" }`, e.g. top of the "Home" section).
4. Commit the deepened tools + `/console/demo` + the recovered multi-source doc. Push. `vercel --prod --yes`.
5. Confirm the deploy is Ready.

## How to resume the running workflow if needed
It runs in THIS session's task list (`wqfqbcl66`). A fresh `claude` session will NOT receive its
completion notification. If you started fresh: check `/private/tmp/.../tasks/wqfqbcl66.output` for the
result, or just inspect the working tree (files above) and finish steps 1–5 manually. The workflow
script is `.claude/workflows/builder-track-deepen.js` (re-runnable via Workflow scriptPath if needed).

## Constraints / gotchas
- **API budget:** the app Anthropic key had a self-set usage limit; user raised $5 → $50. It briefly
  hit the cap mid-session (hard 400, "regain access 2026-08-01"). `lib/claude.ts` now has 429/529/503
  backoff (NOT 400 — that's a hard cap). Be economical with benchmark runs (~$2–3 each).
- Workflow scripts are plain JS (no TS types); every agent-opts object must be brace-balanced or the
  parser errors ("Unexpected token"). No `Date.now()`/`Math.random()` in scripts.
- `.env.vercel.local` / `.env.local` are git-ignored — never commit; delete pulled env after use.
- User preferences (see memory): prefers product code over tests; wants full engine usage; be honest
  about benchmark results (don't spin).
