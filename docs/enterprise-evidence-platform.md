# PaperTrail — Enterprise Evidence Intelligence Platform (Architecture)

Provenance-grade evidence infrastructure for regulated pharma (medical affairs, regulatory,
HEOR, R&D). Claude assembles; deterministic engines verify every number; a hash-chained
audit trail makes it defensible for regulated use. Built on open data — no proprietary
EHR/wet-lab. Comparable to Causaly, Aetion (~$1B), Open Targets, DistillerSR, Flatiron.

## Layered architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Enterprise surface: /console (RBAC UI) · versioned /api/v1 · webhooks │
│                       · SSO · usage metering · SLA/observability      │
├─────────────────────────────────────────────────────────────────────┤
│ Governance: dossier lifecycle (draft→review→approved→published)       │
│  · e-signature approval (21 CFR Part 11) · hash-chained audit         │
│  · RBAC (author/reviewer/approver/admin) · data-source provenance     │
├─────────────────────────────────────────────────────────────────────┤
│ Platform (unicorn-backend): Evidence Dossier orchestrator ·           │
│  Biomedical Knowledge Graph · Provenance/export · RWE signals         │
├─────────────────────────────────────────────────────────────────────┤
│ Deterministic engines: 11 bio engines · meta-analysis/GRADE/survival  │
│  · effect-size/grounding · pharmacovigilance — NO LLM in the numbers  │
├─────────────────────────────────────────────────────────────────────┤
│ Open data: Open Targets · GWAS · ClinVar · ChEMBL · PharmGKB ·        │
│  FAERS · PubTator · PubMed · ClinicalTrials.gov  (cached in Postgres) │
└─────────────────────────────────────────────────────────────────────┘
```

## Enterprise capabilities (what makes it sellable to pharma)

1. **Multi-tenant dossier lifecycle & versioning** — org-scoped evidence dossiers with
   immutable versions and status `draft → in_review → approved → published → archived`.
   Every version is a fixed snapshot; nothing published can be silently edited.
2. **Review & approval workflow (21 CFR Part 11)** — author → reviewer → approver, each
   step e-signed (reuse `lib/signatures`), hash-chained into a tamper-evident audit log
   (reuse `lib/audit` + the provenance chain). A published dossier carries the signature
   manifest and the provenance hash of every number.
3. **RBAC on evidence artifacts** — roles author/reviewer/approver/admin; `requireRole`
   gates create/review/approve/publish; org_id is always the first predicate.
4. **Data-source provenance registry** — every number traces to a source record with its
   database, version/snapshot date, license, and access timestamp — the audit an HTA or
   FDA reviewer expects.
5. **Enterprise API + webhooks** — versioned `/api/v1` for dossiers/evidence/graph, org
   API keys with per-plan quotas (reuse `lib/apiusage`), webhooks on dossier lifecycle
   events (reuse `lib/webhooks`).
6. **Usage metering & billing** — per-org metering of dossier builds, engine calls, and
   Claude tokens, wired to plans/quotas (reuse `lib/billing`).
7. **Observability & SLA** — `/api/health` subsystem checks, structured logs (never claim
   text), error tracking, and per-engine latency/availability.
8. **Compliance & validation** — a validation status per dossier (which engines ran, which
   sources were reachable, coverage), and a documented deterministic quality score.

## Enterprise build plan (verticals, run after the compute layer lands)

- **Dossier lifecycle + persistence** — migration (`dossiers`, `dossier_versions`), repo,
  org-scoped `/api/dossiers` CRUD + `/publish` + versioned reads, RBAC + audit.
- **Review & approval** — review requests, e-sign approval, published-manifest, on top of
  the existing reviews/signatures modules.
- **Enterprise API v1 + webhooks** — `/api/v1/dossiers|graph|evidence`, API-key auth,
  quotas, lifecycle webhooks.
- **Governance & metering** — data-source provenance registry, usage metering per org,
  validation status, observability.

Every enterprise route is org-scoped (`withOrg` + `requireRole` + `writeAudit`, `org_id`
first predicate, never trust a client org_id); every number stays deterministic; Claude is
orchestration/narrative only.
