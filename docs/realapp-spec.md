# PaperTrail — Real-Application Build Spec

_From a 7-agent design workflow (product / API-architecture / reliability critic / judge lens
→ synthesize → adversarial stress-test → finalize). Executable spec; reliability-first._

## Vision

Turn the working single-claim demo into a **usable, shareable, deployed tool** — without new
schema, new LLM calls on the hot path, or endangering the reliable single-claim core. The key
move: **PaperTrail already `INSERT`s every verification but never reads it back.** So the
highest-value real-app surface is near-zero-risk read-back — permalinks, recent list, export.

**Demo story (one continuous take on the live URL):** landing → click lecanemab example (catch an
overstatement) → click SPRINT example (confirmed accurate) → share a permanent `/v/:id` permalink →
download the provenance report → show an honest `no_support_found`.

## Route map

| Route | Purpose | LLM calls |
|---|---|---|
| `/` | Landing hero + one-click demo examples + claim input + result (two-column highlight) + copy-permalink + download | 1 verify/claim |
| `/v/[id]` | Read-only re-render of a stored verification (re-grounded against cached source) + download | **0** (DB read) |
| `/recent` | Capped list (20) of recent verifications → link to `/v/:id` | **0** |
| `/eval` | Static render of committed `eval-results.json` (pinned PMIDs, pass/fail, trust scores) | **0** |
| `POST /api/verify` | Verify one claim (keep; now isolated persistence + `returning id` → `verification_id`) | 1 |
| `GET /api/health` | Real status (keep) | 0 |
| `GET /api/verifications/[id]` | Fetch one stored verification joined to source (UUID-validated; 404 on miss) | 0 |
| `GET /api/verifications` | Recent list, LIMIT 20 desc (read-only) | 0 |

## Data model

**NO migration.** The `verifications` table already has `id, claim_text, matched_source_id,
discrepancy_type, trust_score, explanation, flagged_spans jsonb, created_at`. Only code change:
add `returning id` to the existing INSERT so the response carries `verification_id`. Read path
joins `verifications → sources` via `matched_source_id` to re-ground stored spans.

## Build waves

- **Wave 1 — Eligibility + demo-path hardening.** (a) **Deploy to Vercel** (`DEMO_MODE=true`,
  `db:migrate` + `ingest:test-set` against prod Neon, smoke-test both pinned PMIDs on the LIVE
  url) — *needs creds*. (b) Isolate the verifications INSERT in a own try/catch + `returning id`
  (result returns even if persistence fails). (c) Client timeout (~20s AbortController) + retry-once
  on network/timeout only. (d) Cosmetic `VerifyStepper`.
- **Wave 2 — Read-back = the real feature.** Extract `VerificationView` from `page.tsx`; add
  `GET /api/verifications/[id]` (UUID-validated, re-grounds against cached source) + read-only
  `/v/[id]` + copy-permalink; add `GET /api/verifications` (cap 20) + `/recent`.
- **Wave 3 — Story + deliverables.** Landing hero + one-click `DemoExamples` (verbatim from
  `demo-claims.json`); download provenance report (client-side Markdown+HTML via `reportExport.ts`);
  static `/eval` page from a committed `eval-results.json` (run `npm run eval` once, commit output).
- **Day 5 — Freeze + film** the 3-min take on the deployed URL; verify Definition-of-Done; freeze.

## Scope guard (still CUT, even in the "real app")

- **No public/unauthenticated API or API docs** — abuse vector on the $200 budget; judges won't curl it.
- **No real SSE/streaming** of the chain — grounding drops ungroundable spans *after* the model
  returns, so streaming would show unvalidated text and violate the trust guarantee. Cosmetic
  stepper substitutes.
- **No general batch/multi-claim** — uncapped fan-out is the budget killer. `claimSplitter.ts`
  exists; if ever built: hard-cap 5 claims, sequential, cached-only (miss → `no_support_found`).
- **No live eval dashboard** that re-runs on request — static committed JSON only.
- **No pin-to-source / rerank** — invisible under `DEMO_MODE` pinned PMIDs; real cost, not this week.
- **No new migration, no auth/accounts, no change to the retrieve→extract→verify→grounding chain.**

## Budget / latency

`DEMO_MODE=true` in prod = cache-only retrieval (no external latency/spend). Extraction is
DB-cached per source; only `verifyClaim` costs tokens, and the two demo claims hit cached
sources+findings, so a full rehearsal ≈ 2 verify calls. Read-back pages (`/v`, `/recent`, `/eval`,
report) make **zero** LLM/embedding calls. Run `npm run eval` exactly once and commit the output.
Keep the in-memory rate limiter on `POST /api/verify` (not relied on for any public endpoint —
there are none). Full rehearsal stays in low-cents against the $200 cap.
