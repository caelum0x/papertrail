export const meta = {
  name: 'autonomous',
  description: 'PaperTrail autonomous expansion loop — builds a batch of BIG Claude-powered product capabilities (research copilot, agentic paper QA, long-form cited synthesis, active-learning screening) with Claude as the heavy core and the deterministic engine as the trust layer, self-integrates, hardens, and returns the remaining backlog so re-running continues autonomously.',
  whenToUse: 'To keep expanding PaperTrail into a full, feature-complete AI research platform, Claude-forward, one big batch per run. Re-run to continue the backlog.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint Claude-heavy verticals: copilot, paper-QA, cited synthesis, active-learning screening' },
    { title: 'Verify', detail: 'adversarial review: is Claude really the core? is every claim grounded/verified?' },
    { title: 'Chain', detail: 'wire pages + nav + authoritative tsc/tests' },
    { title: 'Harden', detail: 'discovery-driven fixes on shared files' },
    { title: 'Report', detail: 'results + remaining backlog for the next autonomous run' },
  ],
}

// Mindset — see docs/BUILD_MINDSET.md (single source of truth).
const MIND = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector + Anthropic Claude.
GOAL: the FULL feature-complete AI research platform (not an MVP/demo). GO BIG.

THREE NON-NEGOTIABLES (docs/BUILD_MINDSET.md):
1. Claude is the high-volume CORE — genuinely hard work (agentic full-paper reading, structured
   extraction where regex fails, multi-step synthesis, long-form generation, conversational
   tool-use, continuous re-analysis). NOT thin RAG. Use lib/claude.ts (getClaude, CLAUDE_MODEL,
   callClaudeForJson); validate EVERY structured Claude output with a Zod schema before use.
2. The deterministic engine is the TRUST LAYER that ENABLES heavy Claude use — verify/ground every
   Claude factual/numeric claim with the existing engines (lib/grounding.ts exact-span grounding,
   lib/effectSize, lib/structuredVerification, lib/metaAnalysis, lib/evidenceReport, lib/grade).
   Drop any claim that can't be grounded to a source span.
3. Production-grade: multi-tenant, RBAC, audit, rate-limited, envelope responses, never log claim
   text. Public compute routes mirror app/api/verify/route.ts; org routes use withOrg + requireRole
   + writeAudit (org_id first predicate; never trust client org_id).

INSPIRATION (borrow pages/APIs/architecture/features): Elicit/Consensus (assistant + evidence
tables), PaperQA2 (agentic paper QA with citations), STORM (long-form cited synthesis), ASReview
(active-learning screening), Scite (smart citations). See docs/competitive-landscape.md +
docs/oss-inspiration.md if present.

Reuse building blocks (READ; do not edit unless you own the file): lib/claude.ts,
lib/agents/retrievalAgent.ts (semantic retrieval over cached sources), lib/autoSynthesis.ts,
lib/evidencePipeline.ts (runEvidencePipeline), lib/evidenceReport.ts, lib/grounding.ts,
lib/schemas.ts, lib/tools/registry.ts, components/synthesis/*. Small files, immutability,
explicit error handling. Code-first: one minimal test per new engine, not big suites.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'filesWritten', 'summary', 'claudeUsage', 'grounded', 'testsPassing'],
  properties: {
    vertical: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    claudeUsage: { type: 'string', description: 'exactly where/how Claude does the heavy work' },
    grounded: { type: 'boolean', description: 'true if Claude claims are verified/grounded by the engine' },
    testsPassing: { type: 'boolean' },
    publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'claudeIsCore', 'claimsGrounded', 'productionSafe', 'issues'],
  properties: {
    vertical: { type: 'string' },
    claudeIsCore: { type: 'boolean', description: 'is Claude genuinely the heavy engine (not commodity RAG)?' },
    claimsGrounded: { type: 'boolean', description: 'are Claude factual/numeric claims verified/grounded?' },
    productionSafe: { type: 'boolean', description: 'rate-limited/RBAC/no claim-text logging/Zod-validated?' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

// Full backlog of big Claude-heavy capabilities. This run builds BATCH (first 4);
// the rest are returned so re-running the workflow continues autonomously.
const BACKLOG = [
  'copilot', 'paperQA', 'citedSynthesis', 'activeScreening',
  'structuredExtraction', 'hypothesisGaps', 'smartCitations', 'draftAssistant',
]
const BATCH = ['trialAlerts', 'prismaAutopilot', 'guidelineAudit']

const SPECS = {
  copilot: {
    label: 'build:research-copilot',
    prompt: MIND + `

BUILD the RESEARCH COPILOT — a conversational Claude agent (tool-use) that drives the whole
platform, like Elicit/Consensus's assistant. Own ONLY these NEW files:
- lib/copilot/tools.ts (Claude tool definitions mapping to existing capabilities: verify a claim
  via runEvidencePipeline/verify, run synthesis, search cached sources via retrievalAgent, fetch a
  saved report). Each tool has a Zod input schema.
- lib/copilot/agent.ts (the agent loop: send the user turn + tool defs to Claude via getClaude with
  tool-use, execute requested tools, feed results back, iterate to a final grounded answer with
  citations. Claude does the reasoning + orchestration — this is heavy Claude usage. Never fabricate
  a citation: every source referenced must come from a tool result.)
- lib/copilot/schemas.ts (Zod request/response)
- app/api/copilot/route.ts (public POST { messages }, nodejs, rate-limited, envelope, sanitize +
  never log message text; returns the assistant turn + tool trace + citations)
- app/console/copilot/page.tsx ('use client' chat UI: message list, tool-call trace pills,
  citation chips linking to sources; loading/error) + _components as needed.
Report claudeUsage precisely (the tool-use loop). grounded=true (citations come only from tool
results). Run any test you add; keep tests minimal.`,
  },
  paperQA: {
    label: 'build:agentic-paper-qa',
    prompt: MIND + `

BUILD AGENTIC PAPER QA (PaperQA2-style) — ask a scientific question, Claude retrieves the relevant
cached papers, READS their full text, and answers WITH CITATIONS, every sentence grounded. Own ONLY:
- lib/paperqa/ask.ts (retrieve candidate cached sources via retrievalAgent; for each, have Claude
  read the passage and produce evidence snippets; then Claude composes an answer where EVERY claim
  cites a specific source; use lib/grounding.ts to enforce that each cited snippet is an exact
  substring of the source raw_text — drop ungrounded claims. Claude does the reading + synthesis =
  heavy Claude. callClaudeForJson with a Zod schema for the structured answer.)
- lib/paperqa/schemas.ts (Zod)
- app/api/paper-qa/route.ts (public POST { question, limit? }, nodejs, rate-limited, envelope,
  never log question text)
- app/console/ask/page.tsx ('use client': question box, streamed/loading answer with inline
  citation superscripts linking to sources, and a per-claim grounding indicator) + _components.
Report claudeUsage (reading + synthesis) and grounded=true (grounding.ts enforced). Minimal test.`,
  },
  citedSynthesis: {
    label: 'build:cited-synthesis-report',
    prompt: MIND + `

BUILD LONG-FORM CITED SYNTHESIS (STORM-style) — generate a structured, multi-section, fully-cited
evidence review on a topic/claim, grounded in the deterministic evidence pipeline. Own ONLY:
- lib/synthesisReport/generate.ts (run runEvidencePipeline (or autoSynthesize) for the topic to get
  the verified pooled evidence + sources; then Claude drafts a structured review — Background,
  Methods, Findings (must state the ENGINE's pooled numbers verbatim, never invent numbers),
  Certainty (from GRADE), Limitations — with inline citations to the used sources. Claude writes the
  prose; the engine supplies every number; ground factual claims to sources. callClaudeForJson or a
  structured multi-section schema, Zod-validated.)
- lib/synthesisReport/schemas.ts (Zod)
- app/api/synthesis-report/route.ts (public POST { topic, query? }, nodejs, rate-limited, envelope)
- app/console/synthesis-report/page.tsx ('use client': topic box -> rendered review with sections,
  citations, GRADE badge, and an Export button reusing lib/evidenceReportExport if useful) + _components.
Report claudeUsage (long-form drafting) and grounded=true (numbers from engine, claims grounded).
Minimal test (mock Claude).`,
  },
  activeScreening: {
    label: 'build:active-learning-screening',
    prompt: MIND + `

BUILD AI ACTIVE-LEARNING SCREENING (ASReview-style) for systematic reviews — Claude ranks candidate
records by relevance to a review's inclusion criteria with a rationale, so a reviewer screens the
most-likely-relevant first. READ the existing SR module (app/api/sr-projects, app/api/sr-records,
lib/reviews or app/api/sr-projects/lib) for the record/criteria shapes; do NOT edit it. Own ONLY:
- lib/screening/aiRank.ts (given inclusion criteria + a batch of records {title, abstract}, Claude
  scores each 0-1 relevance + include/exclude/uncertain + a one-line rationale grounded in the
  abstract; callClaudeForJson with a Zod array schema, validated; batch efficiently. Heavy Claude
  over many abstracts = real scale.)
- lib/screening/schemas.ts (Zod)
- app/api/screening/ai-rank/route.ts (org-scoped withOrg POST — screening data is tenant data;
  requireRole(editor); accepts a project id + optional batch, ranks its pending records, returns the
  ranking; writeAudit; never trust client org_id; never log abstract text beyond metadata)
- a small UI hook: app/console/screening/_components/AiRankPanel.tsx (a button to AI-rank pending
  records + a ranked list with relevance + rationale). Do NOT edit the screening page itself; export
  the component for the integration phase to wire (or wire it if trivially additive).
Report claudeUsage (per-abstract reasoning at scale) and grounded (rationale from abstract). Minimal test.`,
  },
  structuredExtraction: {
    label: 'build:structured-extraction',
    prompt: MIND + `

BUILD STRUCTURED PAPER EXTRACTION (RobotReviewer/LlamaExtract-style) — Claude reads a full paper and
extracts PICO (population, intervention, comparator, outcomes) + every reported effect size + endpoints
into structured, Zod-validated data, with the deterministic engine verifying each number. Own ONLY:
- lib/extraction/paperExtract.ts (Claude reads the full raw_text — heavy long-context Claude — via
  callClaudeForJson against a strict PICO+effects Zod schema; for each extracted effect, GROUND the
  supporting quote to an exact span with lib/grounding.ts and reconcile the number with lib/effectSize
  parseEffectSizes — drop or flag any effect whose quote can't be grounded. NO fabricated numbers.)
- lib/extraction/schemas.ts (Zod PICO + effect record)
- app/api/extraction/paper/route.ts (public POST { text | source_id }, nodejs, rate-limited, envelope,
  sanitize, never log text)
- app/console/extraction/page.tsx ('use client': paste text or pick a source -> a structured PICO card +
  an effects table with a grounded-quote per row) + _components.
Report claudeUsage (full-paper reading) + grounded=true. Minimal test (grounding invariant, mock Claude).`,
  },
  hypothesisGaps: {
    label: 'build:hypothesis-gaps',
    prompt: MIND + `

BUILD HYPOTHESIS & RESEARCH-GAP ANALYSIS (AI-Scientist-style, but grounded) — Claude analyzes an
evidence set and surfaces where the evidence is thin/absent/conflicting and proposes TESTABLE hypotheses,
each tied to the specific gap. Own ONLY:
- lib/hypotheses/generate.ts (take a topic/claim, run runEvidencePipeline (lib/evidencePipeline) to get
  the verified evidence + coverage, then Claude reasons over WHAT the pooled evidence does and does NOT
  establish — heterogeneity, missing populations, secondary-only endpoints, wide CIs — and proposes
  gaps + hypotheses. Every gap must cite the concrete evidence signal from the engine that supports it;
  Claude may NOT invent a finding. callClaudeForJson + Zod.)
- lib/hypotheses/schemas.ts (Zod)
- app/api/hypotheses/route.ts (public POST { topic, query? }, nodejs, rate-limited, envelope, never log text)
- app/console/hypotheses/page.tsx ('use client': topic -> gap cards (evidence signal + why it's a gap) +
  proposed testable hypotheses) + _components.
Report claudeUsage (reasoning over the evidence base) + grounded (gaps tied to engine signals). Minimal test.`,
  },
  smartCitations: {
    label: 'build:smart-citations',
    prompt: MIND + `

BUILD SMART CITATIONS (Scite-style) — classify HOW one paper cites another: supporting / contrasting /
mentioning, with the citation context quote. Own ONLY:
- lib/citations/classify.ts (given a citing passage + the cited source's claim/finding, Claude classifies
  the stance and extracts the exact citation-context sentence; GROUND that sentence to the citing text
  with lib/grounding.ts — drop ungroundable. callClaudeForJson + Zod. This is real Claude reasoning over
  citation semantics, not a lookup.)
- lib/citations/schemas.ts (Zod: stance enum supporting|contrasting|mentioning + grounded quote + confidence)
- app/api/citations/classify/route.ts (public POST { citing_text, cited_claim }, nodejs, rate-limited,
  envelope, sanitize, never log text)
- app/console/citations/page.tsx ('use client': paste a citing passage + cited claim -> stance badge +
  grounded context) + _components.
Report claudeUsage (stance reasoning) + grounded=true. Minimal test (stance + grounding, mock Claude).`,
  },
  draftAssistant: {
    label: 'build:draft-assistant',
    prompt: MIND + `

BUILD the DRAFT ASSISTANT — Claude drafts a manuscript/grant section grounded in a VERIFIED evidence
report, and self-corrects: every efficacy claim in the draft is checked against the engine's numbers and
sources, and overstatements are flagged/corrected. This is "the AI research assistant that proves it."
Own ONLY:
- lib/drafting/assist.ts (input: a topic/claim (+ optional section type). Run runEvidencePipeline for the
  verified pooled evidence + sources. Claude drafts the prose (heavy Claude), then EACH sentence that
  makes a numeric/efficacy claim is verified: reconcile its stated magnitude against the engine's pooled
  number via lib/effectSize/synthesisVerification, and ground supporting quotes via lib/grounding.ts.
  Return the draft WITH per-sentence {grounded, corrected?, engineNumber} annotations — overstated
  sentences are auto-corrected to the engine's value and flagged. Numbers come from the engine, never Claude.)
- lib/drafting/schemas.ts (Zod)
- app/api/drafting/route.ts (public POST { topic, section? }, nodejs, rate-limited, envelope, never log text)
- app/console/draft/page.tsx ('use client': topic -> drafted section with inline citations, a green
  'grounded' / amber 'corrected' marker per sentence, and the correction shown) + _components.
Report claudeUsage (drafting) + grounded=true (self-correction via the engine). Minimal test.`,
  },
  knowledgeGraph: {
    label: 'build:knowledge-graph',
    prompt: MIND + `

BUILD an EVIDENCE KNOWLEDGE GRAPH (Causaly / txtai-GraphRAG-style) — Claude extracts entities
(drug/intervention, condition, population, outcome, trial) and typed relations (treats, reduces_risk_of,
associated_with, contradicts) from cached sources; store + query + visualize the graph. Own ONLY:
- lib/graph/extract.ts (Claude reads each source's raw_text and extracts entities + relations via
  callClaudeForJson + a strict Zod schema — heavy Claude reasoning over biomedical text; GROUND each
  relation to the exact supporting sentence via lib/grounding.ts, dropping ungroundable relations.)
- lib/graph/schemas.ts (Zod entity/relation)
- lib/graph/build.ts (aggregate extracted triples across sources into a graph { nodes, edges } with
  provenance (which source + grounded span) on every edge; pure aggregation, no LLM)
- app/api/graph/route.ts (public POST { source_ids | text }, nodejs, rate-limited, envelope, never log text)
- app/console/graph/page.tsx ('use client': a deterministic SVG/force node-link graph of entities +
  relations; click an edge to see its grounded source sentence) + _components.
Report claudeUsage (entity/relation extraction) + grounded=true (edges carry grounded spans). Minimal test.`,
  },
  deepResearch: {
    label: 'build:deep-research',
    prompt: MIND + `

BUILD a MULTI-AGENT DEEP-RESEARCH workflow (gpt-researcher / open_deep_research-style, but grounded) —
given a research question, Claude PLANS sub-questions, runs the evidence pipeline for each, and synthesizes
a comprehensive, cited report. Own ONLY:
- lib/deepResearch/run.ts (Stage 1: Claude decomposes the question into 3-6 focused sub-questions
  (callClaudeForJson + Zod). Stage 2: for each, run runEvidencePipeline (lib/evidencePipeline) to get
  verified pooled evidence + sources — real deterministic evidence per sub-question. Stage 3: Claude
  synthesizes a structured report across the sub-answers, where every number comes from the engine and
  every claim cites a source; ground via lib/grounding.ts. This fans out many Claude + pipeline calls =
  genuinely heavy, high-volume Claude. Make retrieval/pipeline injectable so it tests offline.)
- lib/deepResearch/schemas.ts (Zod)
- app/api/deep-research/route.ts (public POST { question }, nodejs, rate-limited, envelope, never log text)
- app/console/deep-research/page.tsx ('use client': question -> the sub-question plan, per-sub-question
  evidence, and the synthesized cited report; show progress) + _components.
Report claudeUsage (plan + per-subquestion + synthesis) + grounded=true. Minimal test (mock pipeline+Claude).`,
  },
  dataChat: {
    label: 'build:data-chat',
    prompt: MIND + `

BUILD CONVERSATIONAL ANALYSIS over the ORG's own evidence library — chat where Claude answers questions
about the org's saved evidence reports, sources, and claims via tool-use over TENANT data. Own ONLY:
- lib/dataChat/tools.ts (Zod-validated tools reading ONLY the caller's org data: list/get saved evidence
  reports (lib/evidenceReports/repository), search the org's sources, fetch a claim — every query
  org-scoped by the passed orgId, never a client value)
- lib/dataChat/agent.ts (a Claude tool-use loop like lib/copilot/agent.ts but scoped to the org's data;
  heavy Claude; answers cite the specific saved report/source the tool returned — no fabrication)
- lib/dataChat/schemas.ts (Zod)
- app/api/data-chat/route.ts (ORG-SCOPED withOrg POST — this reads tenant data; requireRole(viewer);
  per-org rate limit; writeAudit the query (counts only); never trust client org_id; never log message text)
- app/console/data-chat/page.tsx ('use client' chat UI sending x-org-id from localStorage pt_active_org,
  message list + citations to the org's own reports/sources) + _components.
Report claudeUsage (tool-use over org data) + productionSafe (org-scoped + RBAC + audit). Minimal test.`,
  },
  trialAlerts: {
    label: 'build:trial-alerts',
    prompt: MIND + `

BUILD CLAUDE-ASSESSED EVIDENCE ALERTS (Trialstreamer-style) — when a NEW source relevant to a watched
topic appears, Claude assesses whether it MATTERS: is it relevant, and would it change the current pooled
verdict? Own ONLY:
- lib/alerts/assess.ts (input: a watched topic (+ optionally a saved evidence report's current verdict) and
  a candidate new source. Claude reads the source and returns {relevant, relevanceReason, likelyImpact:
  'confirms'|'weakens'|'overturns'|'none', impactReason} via callClaudeForJson + Zod — grounded: the
  reason must quote the source (ground via lib/grounding.ts). Heavy Claude reasoning over impact.)
- lib/alerts/schemas.ts (Zod)
- app/api/alerts/assess/route.ts (ORG-SCOPED withOrg POST — watches are tenant data; requireRole(viewer);
  per-org rate limit; writeAudit; never trust client org_id; never log source/topic text)
- app/console/alerts/page.tsx ('use client': enter a topic + paste/pick a new source -> an impact badge
  (confirms/weakens/overturns) + grounded reasoning; sends x-org-id) + _components.
Report claudeUsage (impact assessment) + productionSafe (org-scoped). Minimal test (mock Claude).`,
  },
  prismaAutopilot: {
    label: 'build:prisma-autopilot',
    prompt: MIND + `

BUILD PRISMA SYSTEMATIC-REVIEW AUTOPILOT — orchestrate the WHOLE review from a question: ingest candidate
sources, dedupe, AI-screen, extract, and synthesize, chaining EXISTING PaperTrail pieces (this is heavy,
high-volume Claude across screening + extraction + synthesis). Own ONLY:
- lib/prisma/autopilot.ts (runPrismaAutopilot({ question, criteria, sources|source_ids }, deps?): (1) gather
  candidate records (from provided sources or lib/ingest searchAndCache); (2) AI-screen each with the
  existing lib/screening aiRank (Claude relevance + rationale); (3) for included records, run the existing
  lib/extraction paperExtract (Claude PICO + effects, grounded); (4) run runEvidencePipeline / buildEvidence
  Report to synthesize the included evidence; (5) return a PRISMA-flow summary { identified, screened,
  included, excluded, extractedEffects, report } + the counts for a PRISMA diagram. Make retrieval/Claude
  injectable so it tests offline. Import existing modules — do NOT edit them.)
- lib/prisma/schemas.ts (Zod)
- app/api/prisma/autopilot/route.ts (public POST { question, criteria, source_ids? }, nodejs, rate-limited,
  envelope, never log text)
- app/console/prisma/page.tsx ('use client': question + criteria -> a live PRISMA flow (identified ->
  screened -> included) + the synthesized evidence report) + _components.
Report claudeUsage (screening+extraction+synthesis fan-out) + grounded=true. Minimal test (mock deps).`,
  },
  guidelineAudit: {
    label: 'build:guideline-audit',
    prompt: MIND + `

BUILD GUIDELINE / PRESS-RELEASE AUDIT — the "point PaperTrail at published science" capability: paste a
clinical guideline or press release, Claude extracts EVERY efficacy claim it makes, and PaperTrail verifies
each against primary sources, flagging overstatements. Own ONLY:
- lib/guidelineAudit/audit.ts (Stage 1: Claude reads the document and extracts each discrete efficacy claim
  as a verifiable statement (callClaudeForJson + Zod, grounded to the exact sentence via lib/grounding.ts).
  Stage 2: for EACH extracted claim, run the verification path (runEvidencePipeline / verify) to get a
  verdict + trust score. Return { claims:[{ text, groundedSpan, verdict, trustScore, pooledFinding }],
  summary:{ total, overstated, unsupported, accurate } }. Heavy Claude (extraction) + deterministic verify.
  Make verify/pipeline injectable for offline tests.)
- lib/guidelineAudit/schemas.ts (Zod)
- app/api/guideline-audit/route.ts (public POST { text }, nodejs, rate-limited, sanitize, envelope, never log text)
- app/console/guideline-audit/page.tsx ('use client': paste a document -> a claim-by-claim audit table
  with per-claim verdict badge + grounded sentence + the primary-source finding) + _components.
Report claudeUsage (claim extraction) + grounded=true. Minimal test (mock verify).`,
  },
}

// PHASE 1 — BUILD -> VERIFY
phase('Build')
log('Autonomous batch: research copilot, agentic paper QA, cited synthesis, active-learning screening — Claude as the heavy core.')
const built = await pipeline(
  BATCH.map((k) => SPECS[k]),
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { build: null, verdict: null }
    return agent(
      MIND + `

ADVERSARIALLY VERIFY this vertical. Files: ` + (build.filesWritten || []).join(', ') + `.
Judge HARD against the three non-negotiables:
1. claudeIsCore — is Claude doing genuinely hard work (reasoning/reading/synthesis/tool-use), or is
   it thin commodity RAG that a competitor trivially replicates? Be strict.
2. claimsGrounded — is every factual/numeric claim Claude emits verified or grounded to a source
   span (grounding.ts / engine numbers), or can Claude fabricate a citation/number?
3. productionSafe — rate-limited (public) or RBAC+org-scoped (tenant), Zod-validated, never logs
   claim/abstract/question text, envelope responses.
Read the files, run any test. Put failures in issues as 'blocker' (esp. ungrounded claims or Claude
being a bystander). Default the three booleans to false if you cannot confirm.`,
      { label: 'verify:' + build.vertical, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const strong = verticals.filter((v) => v.verdict?.claudeIsCore && v.verdict?.claimsGrounded && v.verdict?.productionSafe)
log('Build+Verify: ' + strong.length + '/' + verticals.length + ' verticals are Claude-core + grounded + production-safe.')

// PHASE 2 — CHAIN (nav + authoritative build)
phase('Chain')
log('Wiring nav + panels + authoritative tsc/tests…')
const integration = await agent(
  MIND + `

INTEGRATE this batch and keep the app green.
1. For EVERY new app/console/<x>/page.tsx created in this batch, add a nav link to NAV_SECTIONS in
   app/console/layout.tsx under the most fitting section (Research for research tools, Review & report
   for outputs). Use a concise human label. Do a git status / ls app/console to find the new pages.
   Minimal edits; don't duplicate existing links.
2. Wire any exported panel component into its host page if trivially additive; otherwise note it.
3. Run npx tsc --noEmit and fix type errors in this batch's files; run npx vitest run and fix genuine
   breakage (fix wrong CODE, not correct tests).
Report tsc pass/fail, vitest counts, and every file edited. Be honest if anything is red.`,
  { label: 'integrate:nav', phase: 'Chain', effort: 'high' }
)

// PHASE 3 — HARDEN
phase('Harden')
const harden = await agent(
  MIND + `

HARDEN with MINIMAL correct edits. Do NOT touch files another agent is building this round
(lib/copilot/*, lib/paperqa/*, lib/synthesisReport/*, lib/screening/*, their routes/pages,
app/console/layout.tsx). Targets: any public route missing rate limit/try-catch; any Claude/JSON.parse
of model output without Zod; any org route trusting client org_id / missing requireRole; any place
claim/question/abstract text is logged. Run npx tsc --noEmit and npx vitest run; report the exact
files edited and results. If clean, say so.`,
  { label: 'harden:api', phase: 'Harden', effort: 'high' }
)

// PHASE 4 — REPORT
phase('Report')
return {
  batch: BATCH,
  remainingBacklog: BACKLOG.filter((k) => !BATCH.includes(k)),
  verticals: verticals.map((v) => ({
    vertical: v.build?.vertical, files: v.build?.filesWritten || [], claudeUsage: v.build?.claudeUsage || '',
    claudeIsCore: v.verdict?.claudeIsCore ?? null, claimsGrounded: v.verdict?.claimsGrounded ?? null,
    productionSafe: v.verdict?.productionSafe ?? null,
    blockers: (v.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: v.build?.summary || '',
  })),
  integrationReport: integration,
  hardenReport: harden,
  strong: strong.length,
  total: verticals.length,
}
