# Deploy Guide

PaperTrail is a Next.js 14 (App Router) app backed by Postgres + pgvector (Neon)
and deployed on Vercel. This guide covers the environment variables, the Vercel
Cron job, database migrations, and the health check needed to run it in
production.

## Prerequisites

- A Neon Postgres database with the `pgvector` extension available.
- An Anthropic API key (Claude) for extraction/verification reasoning.
- A Voyage AI key for embeddings.
- A Vercel project connected to this repository.

## Environment variables

Copy `.env.example` to `.env.local` for local dev, and set the same keys in the
Vercel project settings for production. `.env.local` is git-ignored — never
commit real keys.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon Postgres connection string. Must include `sslmode=require`. |
| `AUTH_SECRET` | Yes (prod) | HS256 secret for signing auth session JWTs. Generate with `openssl rand -base64 32`. A dev fallback is used if unset — never rely on it outside local dev. |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for extraction + verification reasoning. |
| `ANTHROPIC_MODEL` | No | Claude model id (default `claude-sonnet-4-6`). |
| `VOYAGE_API_KEY` | Yes | Voyage AI embeddings key. |
| `VOYAGE_MODEL` | No | Embeddings model (default `voyage-3`). |
| `NCBI_API_KEY` | No | Raises PubMed E-utilities rate limit from 3/sec to 10/sec. |
| `NCBI_EMAIL` | No | Contact email sent with NCBI requests. |
| `RATE_LIMIT_MAX` | No | Max requests per window per IP for `/api/verify` (default 10). |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window in ms (default 600000). |
| `DEMO_MODE` | No | `true` makes retrieval cache-only (never live-fetches on a miss). Set for a deterministic live demo. |
| `MOCK_MODE` | No | `true` answers locked demo claims from hand-verified fixtures with no Postgres/Claude/Voyage calls. Dev/demo-fallback only — leave `false` in prod. |
| `CRON_SECRET` | Yes (prod) | Shared secret Vercel Cron sends as a Bearer token to `/api/cron/tick`. Without it, the cron endpoint fails closed. |

Set the required variables (`DATABASE_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`,
`VOYAGE_API_KEY`, `CRON_SECRET`) in the Vercel dashboard before the first
production deploy.

## Database migrations

Migrations live in `db/migrations.sql` (base) and `db/migrations/*.sql` (applied
in filename order). All migration files are idempotent, so the command is safe to
re-run.

```bash
npm run db:migrate
```

`DATABASE_URL` must be set (from `.env.local` locally, or exported in your shell)
or the script exits with a clear error. Run this once against the production
database after provisioning, and again whenever new migration files are added.

## Vercel Cron and CRON_SECRET

`vercel.json` registers one cron job:

```json
{
  "crons": [{ "path": "/api/cron/tick", "schedule": "*/5 * * * *" }]
}
```

Every 5 minutes Vercel invokes `GET /api/cron/tick`. When `CRON_SECRET` is set in
the Vercel project, Vercel automatically sends it as
`Authorization: Bearer <CRON_SECRET>`; the route verifies it with a constant-time
comparison. If `CRON_SECRET` is unset, the route **fails closed** and returns
`401` — it never runs unauthenticated.

The handler iterates every org, draining each org's due schedules and runnable
background jobs. One org's failure is logged and skipped; it does not abort the
sweep. This is the multi-tenant counterpart to the session-authenticated
`/api/jobs/tick` (which processes a single org via `x-org-id`).

To set the secret:

1. Generate a value: `openssl rand -base64 32`.
2. Add it as `CRON_SECRET` in the Vercel project environment for Production.
3. Redeploy so the cron invocations pick it up.

You can smoke-test locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

## Health check

`GET /api/health` is a public, cheap liveness/readiness probe. It:

- pings the DB with a 2s timeout (never throws — the probe itself must not 500),
- reports presence-only booleans for `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`
  (never the values),
- returns the app version and a timestamp.

Response shape:

```json
{
  "status": "ok",
  "checks": { "db": true, "anthropic_key": true, "voyage_key": true },
  "version": "abc1234",
  "timestamp": "2026-07-09T00:00:00.000Z"
}
```

`status` is `"ok"` when the DB is reachable and `"degraded"` when it is not.
Missing model keys degrade LLM features but do not fail the DB gate — they are
surfaced in `checks` for operators. Point your uptime monitor at this endpoint.

## Deploy checklist

1. Provision Neon + pgvector; set `DATABASE_URL` in Vercel.
2. Set `AUTH_SECRET`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `CRON_SECRET`.
3. Run `npm run db:migrate` against the production database.
4. Deploy to Vercel.
5. Verify `GET /api/health` returns `status: "ok"`.
6. Confirm the cron job appears in the Vercel dashboard and returns `200`.
