<p align="center">
  <img src="public/logo.png" alt="PaperTrail" width="190" />
</p>

<h1 align="center">PaperTrail</h1>

<p align="center"><strong>The evidence-verification &amp; provenance platform for regulated life-sciences work.</strong><br/>
<em>Claude reads the literature; a deterministic engine proves every number.</em></p>

<p align="center">
  <a href="https://papertrail-topaz-phi.vercel.app"><strong>▶ Live app</strong></a> ·
  Next.js 16 · Postgres/pgvector · Anthropic Claude · Apache-2.0
</p>

<p align="center">
  Built for <strong>Built with Claude: Life Sciences</strong> (Anthropic × Gladstone Institutes) — <em>Builder Track</em>.
</p>

---

## Table of contents

- [What it is](#what-it-is)
- [The moat: deterministic verification, not vibes](#the-moat-deterministic-verification-not-vibes)
- [Evaluation &amp; limitations (read this)](#evaluation--limitations-read-this)
- [Capabilities](#capabilities)
  - [Claude-powered features](#claude-powered-features)
  - [Deterministic evidence synthesis](#deterministic-evidence-synthesis)
  - [Biomedical evidence engines](#biomedical-evidence-engines)
  - [Evidence Intelligence + enterprise governance](#evidence-intelligence--enterprise-governance)
- [Open source, assimilated](#open-source-assimilated)
- [Documents: upload anything](#documents-upload-anything)
- [Tech stack](#tech-stack)
- [Quickstart (local)](#quickstart-local)
- [Deploy (Vercel + Neon)](#deploy-vercel--neon)
- [API reference](#api-reference)
- [Architecture &amp; docs](#architecture--docs)
- [License &amp; attribution](#license--attribution)

---

## What it is

**The user (Builder Track):** a pharma medical-affairs / regulatory reviewer, a translational
lab, a systematic-review team, or a research coordinator who must **produce and defend the
evidence behind a claim** — and cannot afford to be wrong. Today that is hours of PhD time per
claim, and an unsubstantiated claim is a legal and scientific liability.

PaperTrail is a multi-tenant platform where those teams verify scientific and efficacy claims
against **primary sources**, ingest and mine their own document corpora, run auditable agentic
research workflows, and produce a **defensible provenance trail for every cited number** —
software they can use without the builder in the room, built to outlast the hackathon.

At its center is a differentiator no chatbot can match: a **deterministic verification engine**
that checks a claim against a trial's *own registered statistical results* — with **no LLM in
the numeric loop.**

## The moat: deterministic verification, not vibes

Generic claim verifiers stop at LLM judgment or textual entailment over prose — they assess
whether the literature *agrees* with a claim. PaperTrail independently **recomputes the number
the trial actually registered**:

- **Structured registry verification** (`lib/structuredVerification.ts`) — parses
  ClinicalTrials.gov's `resultsSection`: registered outcome analyses (paramType/paramValue/CI/
  p-value) *and* raw per-arm event counts.
- **Biostatistics recomputed from raw counts** (`lib/biostats.ts`) — absolute risk reduction,
  NNT, risk ratio + 95% CI (log-RR delta method), oracle-tested against epitools/OpenEpi.
- **Endpoint-switch detection** — flags a claim whose magnitude matches a *secondary* outcome,
  not the trial's primary result.
- **Code-enforced exact-span grounding** (`lib/grounding.ts`) — every flagged span is a verbatim
  substring of the cached source; any span the model can't locate is *dropped*. PaperTrail
  structurally cannot make an unsourced claim about a source.
- **Multi-source cross-verification** — corroborated / conflicting / single-source, with a
  deterministic trust-score adjustment.

> Example, from SPRINT's registry: a claim of *"cut cardiovascular risk in half"* is flagged
> **overstates_registry** — the registered primary result is HR 0.75 (95% CI 0.64–0.89), a ~25%
> reduction; raw counts give ARR 1.6 points, NNT 62. No LLM produced that number.

## Evaluation &amp; limitations (read this)

We would rather be honest than impressive.

**Benchmark (balanced 60-case SciFact, 20/20/20, `claude-sonnet-4-6`):** PaperTrail scored **58.3%**
accuracy vs a **Claude-alone** baseline at **70.0%**. **On SciFact, PaperTrail loses.** We are not
hiding it. (This supersedes an earlier invalid 10-case smoke that had sliced a single gold label.)

Three things are true about that result:

1. **It's a task mismatch — the own-it limitation.** [SciFact](https://github.com/allenai/scifact)
   tests *general scientific-claim entailment* (mechanisms, associations). PaperTrail's engine is
   tuned for the **opposite** task — clinical-trial **efficacy-magnitude** verification (recompute
   "reduced events by 30%" against a registry). The confusion matrix is unambiguous: **SUPPORT
   recall 10%, CONTRADICT recall 90%** — it aggressively over-flags and maps SUPPORT → CONTRADICT.
   Outside its design envelope, it over-flags. That's a genuine limitation.
2. **Its honest-abstention holds up:** NEI F1 **73.2** (precision 71.4) — when it can't verify, it
   says so rather than guessing.
3. **It's far more reliable than the raw baseline:** PaperTrail errored on **2/60** cases;
   Claude-alone errored on **16/60** (raw Claude often returned prose instead of valid JSON —
   PaperTrail's Zod-validated pipeline did not).

**Conclusion:** SciFact is the wrong yardstick for PaperTrail, and we do **not** cite 58.3% as a
headline capability number — it's the conservative floor on a mismatched task. A fair benchmark
uses **clinical-efficacy claims** (`tests/fixtures/test-claims.json`) where recompute-from-registry
actually applies. Full methodology + confusion matrices in [`docs/benchmark.md`](docs/benchmark.md).

## Capabilities

### Claude-powered features

Each uses Claude for the genuinely hard natural-language work, then hands every factual/numeric
claim to the deterministic engine to ground or recompute it. Structured Claude output is
Zod-validated before use; no flagged span survives that isn't a verbatim substring of the source.

| Capability | Route | Console |
|---|---|---|
| **Lab-notebook companion** — a wet-lab scientist's rough notes → a structured, searchable, grounded experiment record (protocol steps, reagents, samples, outcomes auto-tagged; every quoted field a verbatim note span) | `/api/lab-notebook` | `/console/lab-notebook` |
| **Clinical-trial matcher** — de-identified patient notes → ranked eligible ClinicalTrials.gov trials, with per-criterion inclusion/exclusion reasoning shown for every match | `/api/trial-matcher` | `/console/trial-matcher` |
| **Research copilot** — tool-driven agent loop over your corpus (incl. biomedical evidence) | `/api/copilot` | `/console/copilot` |
| **Agentic paper-QA** — read retrieved papers, answer with grounded citations | `/api/paper-qa` | `/console/ask` |
| **Long-form cited synthesis** — multi-section review; engine supplies every number | `/api/synthesis-report` | `/console/synthesis-report` |
| **Multi-agent deep research** — plan → research sub-questions → synthesize | `/api/deep-research`, `/api/research` | `/console/deep-research` |
| **Guideline / press-release audit** — extract every efficacy claim, verify each | `/api/guideline-audit` | `/console/guideline-audit` |
| **Draft assistant** — Claude drafts; engine reconciles every magnitude, grounds every quote | `/api/drafting` | `/console/draft` |
| **Full-paper extraction** — PICO + endpoints + every effect size with exact quotes | `/api/extraction/paper` | `/console/extraction` |
| **Hypothesis / research-gap analysis** — grounded gaps + testable hypotheses | `/api/hypotheses` | `/console/hypotheses` |
| **Smart-citation stance** — supporting / contrasting / mentioning + context | `/api/citations/classify` | `/console/citations` |
| **Evidence knowledge graph** — grounded entities/relations into a queryable graph | `/api/graph` | `/console/graph` |
| **Mechanism assembly** — causal statements + belief scores (INDRA-style) | `/api/mechanism` | `/console/mechanism` |
| **Fact-check pipeline** — decompose → retrieve → verify (Loki-style) | `/api/factcheck` | `/console/factcheck` |
| **Data-chat** — conversational analytics over your org's evidence | `/api/data-chat` | `/console/data-chat` |
| **PRISMA autopilot** — ingest → AI-screen → extract → synthesize | `/api/prisma/autopilot` | `/console/prisma` |
| **Evidence alerts** — a new trial lands; Claude judges *would it change the verdict?* | `/api/alerts/assess` | `/console/alerts` |

### Deterministic evidence synthesis

Public, rate-limited, **no LLM in the numeric path** — reproducible from the request body,
oracle-tested against reference tools (metafor / epitools).

`meta-analysis` (fixed + DerSimonian–Laird random effects, I²/τ²/Q, prediction interval) ·
`continuous-meta` (MD + Hedges g) · `network-meta` (Bucher indirect) · `meta-regression` (WLS) ·
`subgroup` (Q-between interaction) · `survival` (Kaplan–Meier, log-rank, Cox) · `dose-response` ·
`trial-sequential` (RIS + O'Brien–Fleming) · `publication bias` (Egger's + trim-and-fill) ·
`GRADE` + `risk-of-bias` · `absolute effects` (ARR/NNT) · `evidence-report` (+ batch, HTML/text/PDF
export, org-scoped persistence).

### Biomedical evidence engines

Deterministic verdicts on the canonical **open** bio-data sources — the stack bio-AI companies
(Causaly, Open Targets, Aetion) monetize — no proprietary EHR or wet lab required.

| Engine | Source | Route |
|---|---|---|
| **Pharmacovigilance** (PRR/ROR/χ²/IC, oracle-tested) | openFDA / FAERS | `/api/bio/safety-signal` |
| **Genetic association** (genome-wide significance) | GWAS Catalog + ClinVar | `/api/bio/genetic-association` |
| **Target–disease evidence** | Open Targets | `/api/bio/target-disease` |
| **Drug bioactivity** (potency/phase) | ChEMBL | `/api/bio/bioactivity` |
| **Variant pathogenicity** (star-rated) | ClinVar | `/api/bio/variant-pathogenicity` |
| **Pharmacogenomics** (evidence level) | PharmGKB | `/api/bio/pharmacogenomics` |
| **Entity normalization** | PubTator / NER | `/api/bio/annotate`, `/api/entities` |
| **Drug–drug interaction** (FAERS-derived) | openFDA | `/api/bio/drug-interaction` |
| **Repurposing / biomarker validation** | composite | `/api/bio/repurposing`, `/api/bio/biomarker` |
| **Unified biomedical claim verifier** — routes a claim across every engine | composite | `/api/bio/verify-claim` |

### Evidence Intelligence + enterprise governance

The layer that makes it sellable to regulated pharma: a **biomedical knowledge graph** (`/api/kg`,
Biolink typing + graph link-prediction), an **evidence-dossier orchestrator** (`/api/dossier` —
target/drug/disease/claim → complete, verified, cited, trust-scored dossier), **hash-chained
provenance + submission export**, **real-world-evidence signals**, and enterprise governance:
data-source provenance registry, versioned `/api/v1` gateway with API-key quotas, per-engine usage
metering, validation/compliance status, a tamper-evident **evidence audit chain** (21 CFR Part
11-style), SLA observability, evidence webhooks, and data-governance (retention + DSAR export).

## Open source, assimilated

We didn't just call libraries — we **ported the real algorithms of 17 open-source projects into
native PaperTrail TypeScript**, running on our own Postgres + API routes + console + grounding
layer. Deterministic math is native TS; Claude is used only where the original relied on a trained
model. The upstream source is retained under `backend/engines/` (excluded from the build); every
project is honored in [`NOTICE`](NOTICE).

| Assimilated | License | Now native in |
|---|---|---|
| ASReview | Apache-2.0 | `lib/screening/activeLearning.ts` (TF-IDF + Naive-Bayes active learning) |
| Loki / OpenFactVerification | MIT | `lib/factcheck/pipeline.ts` |
| MultiVerS · Valsci | Apache-2.0 · MIT | `lib/scieval/*` (SUPPORTS/REFUTES/NEI + rationale) |
| MiniCheck | MIT | `lib/grounding/entailment.ts` |
| gpt-researcher · open_deep_research | Apache-2.0 · MIT | `lib/research/orchestrator.ts` |
| paper-qa (PaperQA2) | Apache-2.0 | `lib/paperqa/*`, `lib/retrieval/contextualRerank.ts` |
| STORM | MIT | `lib/synthesisReport/*`, `lib/synthesis/outline.ts` |
| R2R | MIT | `lib/retrieval/hybrid.ts` (vector + keyword + RRF) |
| INDRA | BSD-2 | `lib/mechanism/assemble.ts` (causal statements + belief) |
| BioCypher | MIT | `lib/kg/biolink.ts` |
| PyKEEN | MIT | `lib/kg/linkPredict.ts` (Adamic-Adar / RA link prediction) |
| scispaCy | Apache-2.0 | `lib/entities/ner.ts` (NER + UMLS linking) |
| PyMARE | MIT | `lib/metaAnalysis.ts`, `lib/metaEstimators.ts` (Hedges / Sidik-Jonkman / Paule-Mandel τ²) |
| pyalex | MIT | `lib/sources/openalex.ts` |
| pytrials | MIT | `lib/sources/clinicaltrials.ts` |

## Documents: upload anything

Upload **PDF, DOCX, XLSX/XLS, CSV, Markdown, or plain text** — a drag-and-drop uploader at
`/console/documents/upload` reads each file to text (mammoth for DOCX, SheetJS for spreadsheets,
`unpdf`/Docling for PDF), with server-side format sniffing (it won't trust a lying MIME type),
org-scoped and audited. Extracted text feeds the same claim/evidence pipeline as everything else.

## Tech stack

- **Next.js 16** (App Router, TypeScript strict), **React 19**, **Tailwind**
- **Postgres + pgvector** (Neon), 58 ordered migrations under `db/migrations/`
- **Anthropic Claude** (extraction, verification, agentic work) · **Voyage** embeddings
- **Auth:** `jose` (HS256 session JWT) + `bcryptjs`, org-scoped API contract (`lib/api/*`)
- **Deterministic math** in native TS (no external stats service); `simple-statistics` for a few quantiles
- **1,000+ tests** (Vitest), CI (GitHub Actions), deployed on Vercel

## Quickstart (local)

**Prerequisites:** Node 20+, a Postgres/pgvector DB ([Neon](https://neon.tech)), an
[Anthropic](https://console.anthropic.com) key, a [Voyage](https://voyageai.com) key.

```bash
cp .env.example .env.local     # fill in real values
npm install
npm run db:migrate             # applies db/migrations.sql then db/migrations/*.sql in order
npm run dev                    # http://localhost:3000 → register at /register, app at /console
```

**Verify the build:**

```bash
npx tsc --noEmit      # type-check (backend/ and reference are excluded)
npm test              # unit + component tests (live-API tests skip without ANTHROPIC_API_KEY)
npm run build         # production build
npm run bench         # accuracy benchmark (spends Claude tokens — see docs/benchmark.md)
```

## Deploy (Vercel + Neon)

Live at **https://papertrail-topaz-phi.vercel.app**.

```bash
# 1. Provision a Neon Postgres, then apply all migrations:
DATABASE_URL="postgresql://…/neondb?sslmode=require" npm run db:migrate

# 2. Set env on Vercel (production):
vercel env add DATABASE_URL production
vercel env add ANTHROPIC_API_KEY production
vercel env add VOYAGE_API_KEY production
vercel env add AUTH_SECRET production      # openssl rand -base64 32
vercel env add CRON_SECRET production      # openssl rand -base64 32

# 3. Deploy:
vercel --prod
```

`GET /api/health` returns `{ status, checks: { db, anthropic_key, voyage_key }, version }` and
never 500s. A Vercel Cron (`vercel.json`) hits `/api/cron/tick` (all-org job sweep, CRON_SECRET-
authed). On the Hobby plan crons run daily; restore `*/5 * * * *` on Pro. `backend/`, `python/`,
and `reference/` are excluded from the upload via `.vercelignore`.

## API reference

All public compute endpoints `POST` a JSON body and return `{ success, data, error }`.

```bash
curl -sX POST "$BASE_URL/api/synthesis" \
  -H 'content-type: application/json' \
  -d '{
    "claim": "Drug X reduced major cardiovascular events by 30%",
    "studies": [
      { "label": "Trial A", "measure": "RR", "point": 0.72, "ci_lower": 0.60, "ci_upper": 0.86 },
      { "label": "Trial B", "measure": "RR", "point": 0.68, "ci_lower": 0.51, "ci_upper": 0.90 }
    ]
  }'
```

## Architecture &amp; docs

- [`docs/enterprise-evidence-platform.md`](docs/enterprise-evidence-platform.md) — the platform architecture
- [`docs/enterprise-architecture.md`](docs/enterprise-architecture.md) — module / page / API blueprint
- [`docs/benchmark.md`](docs/benchmark.md) — benchmark methodology &amp; the honest smoke-test caveat
- [`docs/bio-commercial-landscape.md`](docs/bio-commercial-landscape.md) · [`docs/bio-roadmap.md`](docs/bio-roadmap.md) — bio-AI landscape &amp; backlog
- `PRD.md` — product requirements · `ARCHITECTURE.md` — technical design · `CLAUDE.md` — conventions

## License &amp; attribution

**Apache License 2.0** — see [`LICENSE`](LICENSE). Third-party attributions for the assimilated
open-source projects and consumed open bio-data sources are in [`NOTICE`](NOTICE). GPL/AGPL
projects were deliberately not vendored; where their published approach informed a method, only
the public algorithm was reimplemented independently. Not affiliated with any other product named
"PaperTrail".
