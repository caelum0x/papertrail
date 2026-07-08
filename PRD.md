# PaperTrail — Product Requirements (Enterprise)

## 1. Problem

Regulated life-sciences organizations make thousands of evidence-based claims — in
publications, value dossiers, regulatory submissions, medical-information responses, and
safety reports — and every one must be traceable to a primary source and *accurate to what
that source registered*. Claims drift at every retelling: effect sizes get rounded up,
absolute vs. relative reductions get conflated, non-significant results get stated as
benefits, secondary endpoints get presented as primary. Catching this today is manual,
slow, and unauditable, and existing tools stop at "does the literature agree?" rather than
"does this number match the trial's own registered result?"

## 2. Users (personas)

- **Medical-affairs / med-comms lead** — plans publications, MLR-reviews scientific
  statements, each backed by a verified citation.
- **HEOR analyst** — runs systematic reviews and builds evidence tables for dossiers.
- **Regulatory / medical-writing specialist** — needs a 21 CFR Part 11-grade audit trail,
  e-signatures, and provenance for submissions.
- **Systematic-review methodologist** — PRISMA screening, risk-of-bias, synthesis.
- **Pharmacovigilance officer** — scheduled safety-literature monitoring and signal triage.
- **CRO integration engineer** — embeds verification via the public API and webhooks.
- **Academic translational researcher** — verifies manuscript/grant claims; manages references.
- **Org admin** — SSO/SCIM, members, roles, security policy, billing.

## 3. Goals

- **G1 — Deterministic verification of record.** Verify a claim against a trial's
  registered structured results and raw event counts, recomputing ARR/NNT/RR+CI in code;
  detect magnitude overstatement, dropped significance, and endpoint switching. No LLM in
  the numeric loop.
- **G2 — Provenance you can defend.** Every flag maps to a verbatim source substring
  (code-enforced); an immutable, hash-chained audit trail and e-signatures bind every
  decision to who made it and when.
- **G3 — Evidence at scale.** Ingest and mine hundreds of pages of papers per document
  (bulk PDF extraction), extract candidate claims, and verify across a corpus.
- **G4 — Multi-tenant enterprise platform.** Orgs, RBAC, SSO-ready auth, projects/workspaces,
  collaboration and review workflows, reporting, billing/usage, public API, integrations.
- **G5 — Agentic research.** A composable, observable agent-workflow engine and a Claude
  Science workbench connector for literature review and analysis, all auditable.

## 4. Scope

Multi-tenant web platform (`/console`) plus a public marketing/trust surface, organized into
~25 modules across verification core, documents-at-scale, research (workflows / Claude
Science / systematic review / evaluation / pharmacovigilance / publication planning),
collaboration, and platform/governance (auth, RBAC, audit+e-sign, jobs, billing, API,
MCP tools, notifications, search, analytics, integrations). Target surface ≈ 130 pages /
220 API routes. See `docs/enterprise-architecture.md` for the full map.

## 5. The differentiator (must never regress)

The deterministic core is the product's reason to exist and is protected by tests:
structured registry verification, raw-count biostatistics (oracle-tested), exact-span
grounding (dropped if unlocatable), effect-size reconciliation, cross-source agreement.
Any change that weakens these fails CI.

## 6. Success metrics

- Correct discrepancy classification and registry reconciliation on the labeled fixture set
  and an external benchmark (CliniFact); reported precision/recall/F1.
- 100% of shown flags are verbatim-grounded (span-grounding rate).
- Auditability: every verification, review, and export is attributable via the audit chain.
- Enterprise readiness: multi-tenant isolation, RBAC enforcement, and a green
  `tsc` / `npm test` / `npm run build` on every change.

## 7. Non-goals

- General-purpose (non-biomedical) fact-checking.
- Replacing statistical-analysis software; PaperTrail verifies *claims against registered
  results*, it does not run new trials or analyses.
- Clinical decision-making or medical advice.

## 8. Reference

`ARCHITECTURE.md` and `docs/enterprise-architecture.md` (technical design + module map),
`docs/oss-analysis.md` (OSS alternatives & adopted libraries), `CLAUDE.md` / `AGENTS.md`
(conventions).
