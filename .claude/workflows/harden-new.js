export const meta = {
  name: 'harden-new',
  description: 'Security + quality hardening of the ~20 new Claude/org routes + digested-engine bridges from batches 1-3, UI consistency polish on the new console pages, and a docs/README refresh reflecting the full platform. Directory-disjoint; authoritative verify at the end.',
  whenToUse: 'After a burst of feature building, to harden the new surface (security, prompt-injection, RBAC, logging) and polish/refresh before it grows further.',
  phases: [
    { title: 'Harden', detail: 'parallel disjoint: security (routes/lib), UI polish (console/components), docs refresh' },
    { title: 'Verify', detail: 'authoritative tsc + full vitest + next build' },
    { title: 'Report', detail: 'fixed + residual' },
  ],
}

const CTX = `PaperTrail is a production-grade multi-tenant AI research platform. Across 3 recent batches it
added ~20 new routes + features, most calling Claude, some org-scoped. Conventions: public compute routes
mirror app/api/verify (nodejs, rate-limited via lib/rateLimit, {success,data,error} envelope via
lib/api/response ok/fail, sanitize free text via lib/api/claimInput, NEVER log claim/question/message/source
text). Org routes use withOrg (ctx.org.id) + requireRole for mutations + writeAudit; org_id is the FIRST
predicate; never trust a client org_id. All Claude structured output is Zod-validated before use. Every
factual/numeric claim Claude emits is grounded/verified by the deterministic engine (lib/grounding.ts etc.).`

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['area', 'filesEdited', 'findingsFixed', 'checksPass'],
  properties: {
    area: { type: 'string' }, filesEdited: { type: 'array', items: { type: 'string' } },
    findingsFixed: { type: 'array', items: { type: 'string' } }, residual: { type: 'array', items: { type: 'string' } },
    checksPass: { type: 'boolean' }, summary: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tscPass', 'testsPass', 'buildPass', 'testTotals', 'filesEdited', 'notes'],
  properties: {
    tscPass: { type: 'boolean' }, testsPass: { type: 'boolean' }, buildPass: { type: 'boolean' },
    testTotals: { type: 'string' }, filesEdited: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}

const AREAS = [
  {
    key: 'security', label: 'harden:security', agentType: 'security-reviewer',
    prompt: CTX + `

SECURITY SWEEP + FIX of the NEW surface. Scope: app/api/** (esp. copilot, paper-qa, synthesis-report,
extraction, hypotheses, citations/classify, drafting, graph, deep-research, data-chat, fact-check,
meta-crosscheck, screening/ai-rank, ingest, auto-synthesis, evidence-pipeline) + lib/** for those features
+ lib/engines/* bridges. Do NOT edit app/console or components (another agent owns them). Audit + FIX real
issues with minimal, behavior-preserving diffs:
- PROMPT INJECTION: user text flows into Claude prompts across all these features. Confirm the system prompt
  keeps its instruction boundary and that tool-use loops (copilot, data-chat) can't be steered into calling
  tools with attacker-chosen org/ids; the deterministic grounding must still gate every emitted claim.
- data-chat MUST be org-scoped (withOrg + requireRole + org_id first predicate, never a client org_id);
  copilot too. Verify no tenant-data route is public.
- rate limiting on every public compute route; Zod validation on every body + every Claude JSON output;
  no claim/message/source text in logs or error messages; subprocess bridges never pass secrets/text via argv.
Fix the genuine ones. Then run npx tsc --noEmit and npx vitest run. Report filesEdited, findingsFixed,
residual, checksPass.`,
  },
  {
    key: 'ui', label: 'harden:ui-polish',
    prompt: CTX + `

UI CONSISTENCY POLISH. Scope: app/console/** + components/** ONLY (do NOT edit app/api or lib). The new
pages (copilot, ask, synthesis-report, extraction, hypotheses, citations, draft, graph, deep-research,
data-chat) were built fast by different agents — make them consistent WITHOUT changing behavior: uniform
page header/title pattern, consistent loading/error/empty states (reuse the shared _components used by
older pages like app/console/claims), consistent house Tailwind tokens (bg-paper, text-ink, accent, border
colors), consistent button/badge styling, and accessible labels on inputs. Extract an obvious shared
duplicated piece into components/ only if it is clearly repeated 3+ times and the refactor is safe. Do not
alter any data flow or API calls. Run npx tsc --noEmit. Report filesEdited, findingsFixed, checksPass.`,
  },
  {
    key: 'docs', label: 'harden:docs-refresh',
    prompt: CTX + `

DOCS REFRESH. Scope: README.md + docs/** ONLY (do NOT edit code). The platform grew a lot: 14 Claude-heavy
features across copilot / paper-QA / synthesis / screening / extraction / hypotheses / smart-citations /
drafting / knowledge-graph / deep-research / data-chat, 6 DIGESTED OSS engines (paper-qa, STORM, ASReview,
MiniCheck, PyMARE, pyalex) running as opt-in python subprocess backends, a measured SciFact benchmark
(npm run bench), plus the deterministic verification moat. Update README.md so a stranger understands the
FULL platform: refresh the feature/module table, add a "Claude-powered capabilities" section, a "Digested
OSS engines" section (what each backs + how to enable via python/<engine>/requirements.txt + env flag), a
"Benchmark" section pointing at docs/benchmark.md, and keep the quickstart accurate. Be truthful — only
document what exists (cross-check against app/api + app/console + lib + python/). Update docs/enterprise-
architecture.md's map if present. Report filesEdited.`,
  },
]

// PHASE 1 — HARDEN (parallel, directory-disjoint)
phase('Harden')
log('Hardening the new surface: security fixes, UI polish, docs refresh (directory-disjoint)…')
const results = await parallel(
  AREAS.map((a) => () =>
    agent(a.prompt, { label: a.label, phase: 'Harden', schema: RESULT_SCHEMA, effort: 'high', ...(a.agentType ? { agentType: a.agentType } : {}) })
      .then((r) => ({ key: a.key, r }))
  )
)
const done = results.filter(Boolean)
log('Harden: ' + done.filter((d) => d.r?.checksPass).length + '/' + done.length + ' areas reported green.')

// PHASE 2 — VERIFY (authoritative)
phase('Verify')
const verify = await agent(
  CTX + `

AUTHORITATIVELY VERIFY after this round's hardening. Run in order: npx tsc --noEmit, npx vitest run,
npm run build. Report tscPass, testsPass (with testTotals), buildPass, and notes. If RED, fix minimally —
a hardening/polish edit may have broken an import or a default path; fix the wiring, never weaken a correct
test or delete a security fix. List every file you edited. Be honest about residual red.`,
  { label: 'verify:authoritative', phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' }
)

// PHASE 3 — REPORT
phase('Report')
return {
  areas: done.map((d) => ({ area: d.key, filesEdited: d.r?.filesEdited || [], findingsFixed: d.r?.findingsFixed || [],
    residual: d.r?.residual || [], checksPass: d.r?.checksPass ?? null, summary: d.r?.summary || '' })),
  verify,
}
