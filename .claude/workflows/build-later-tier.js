export const meta = {
  name: 'build-later-tier',
  description: 'Later tier: learned KG link-prediction (PyKEEN), context-aware mechanism (INDRA), Bayesian/sensitivity meta (PyMARE), regulatory submission bundle',
  phases: [
    { title: 'Build', detail: 'four features in parallel, disjoint files' },
    { title: 'Verify', detail: 'adversarial review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL LATER TIER. See docs/roadmap-realworld.md ("Later"). Deepen the deterministic + grounded + auditable',
  'moat and SPECIALIZE more OSS engines IN PLACE (edit backend/engines/<engine>/). Live at',
  'https://papertrail-topaz-phi.vercel.app.',
  '',
  'MOAT RULES (non-negotiable): NO LLM in any numeric/verdict/scoring/training path. Deterministic math decides.',
  'Claude only for language steps (extraction/tagging) that then get grounded via lib/grounding.ts locateSpan',
  '(drop + count ungroundable). Prefer honest insufficient over a forced answer. Never log claim/source text.',
  '',
  'STACK: Next.js 16, TS strict, Postgres/Neon (getPool from @/lib/db, parameterized $1 SQL). Public compute routes',
  'follow app/api/bio/genetic-association/route.ts (runtime nodejs, IP checkRateLimit, zod safeParse, ok/fail',
  'envelope, try/catch). Additive idempotent migrations. Edits to EXISTING core files must be SURGICAL + additive',
  '(new function/field; never rewrite; read the file first). Console pages use theme tokens bg-paper/text-ink/',
  'text-accent/border-ink/15 (read app/console/hypotheses/page.tsx). backend/engines/* is excluded from the Next',
  'build (Python has zero TS impact); each specialization ships a PAPERTRAIL.md.',
  '',
  'FILE OWNERSHIP IS DISJOINT (do not touch another part\'s files, middleware.ts, layout.tsx, mcp/src/server.ts,',
  'or lib/compliance/chain.ts):',
  '  pykeen      -> NEW migration 0068 + lib/kg/learnedLinkPredict.ts + app/api/kg/predict/learned + backend/engines/pykeen/',
  '  mechanism   -> NEW lib/mechanism/context.ts + app/api/mechanism/context-filter + console + backend/engines/indra/ (new file only)',
  '  meta        -> NEW lib/metaBayesian.ts + lib/metaSensitivity.ts + app/api/meta/bayesian + app/api/meta/sensitivity + backend/engines/PyMARE/ (new file only)',
  '  submission  -> NEW lib/submission/* + app/api/submission/bundle + console page',
].join('\n')

const GROUPS = [
  {
    key: 'pykeen',
    body:
      'LEARNED KG LINK-PREDICTION. SPECIALIZE backend/engines/pykeen/ IN PLACE: add pykeen/papertrail_train.py' +
      ' (standalone, stdlib-only — a deterministic TransE-style embedding trainer over a KG edge list read from' +
      ' stdin/JSON: fixed seed, fixed init from a hash of entity/relation ids so runs are reproducible, margin-' +
      ' ranking updates; serialize entity + relation vectors to JSON) + PAPERTRAIL.md documenting the mapping to' +
      ' PyKEEN TransE and how lib/kg consumes the weights. migration 0068_kg-embeddings.sql (idempotent):' +
      ' kg_embeddings(id uuid pk default gen_random_uuid(), kind text check (kind in (\'entity\',\'relation\')),' +
      ' key text, vector double precision[], dim int, trained_at timestamptz default now()); unique index on' +
      ' (kind, key). lib/kg/learnedLinkPredict.ts: NEW deterministic scorer — load embeddings from kg_embeddings,' +
      ' score a candidate (from, predicate, to) by the TransE distance (||from + rel - to||), rank candidates;' +
      ' NO LLM. Also a pure trainer trainKgEmbeddings(edges) in TS (mirrors the Python) so the endpoint can train' +
      ' on demand from kg_edges. app/api/kg/predict/learned/route.ts (POST { from, predicate?, limit? } -> ranked' +
      ' predicted links with distances + a note when embeddings are unavailable). READ lib/kg/* (kg_nodes/kg_edges' +
      ' shape, existing linkPredict.ts) + a recent migration first.',
  },
  {
    key: 'mechanism',
    body:
      'CONTEXT-AWARE MECHANISM EXTRACTION. Extend mechanism assembly to carry biological CONTEXT so preclinical-to-' +
      'human translation is de-risked. NEW lib/mechanism/context.ts: deterministic tagging of each mechanism edge' +
      ' with tissue (UBERON), species (NCBI taxon: human/mouse/rat/in-vitro), and assay/system (OBI-ish: in-vivo /' +
      ' in-vitro / cell-line), extracted by Claude ONLY as candidate tags then GROUNDED to a verbatim source span' +
      ' via locateSpan (drop ungroundable). Plus a pure filterHumanInVivo() and a translation-confidence score' +
      ' (deterministic: human in-vivo > animal in-vivo > in-vitro). SPECIALIZE backend/engines/indra/ IN PLACE:' +
      ' add indra/papertrail_refcontext.py (extract INDRA-style RefContext tissue/species/assay + PAPERTRAIL.md).' +
      ' app/api/mechanism/context-filter/route.ts (POST { text, require_human_in_vivo? } -> mechanisms with context' +
      ' tags + translation confidence, filtered). app/console/mechanism-context/page.tsx + _components. READ' +
      ' lib/mechanism/assemble.ts + lib/mechanism/schemas.ts + lib/grounding.ts first; reuse the assembler, do not rewrite it.',
  },
  {
    key: 'meta',
    body:
      'BAYESIAN + SENSITIVITY META-ANALYSIS. NEW lib/metaBayesian.ts: deterministic conjugate/normal-approx Bayesian' +
      ' random-effects meta — posterior mean + credible interval + a POSTERIOR-PREDICTIVE interval for a new study' +
      ' (closed-form normal approximation; document the approximation; NO MCMC, NO LLM). NEW lib/metaSensitivity.ts:' +
      ' leave-one-out sensitivity (re-pool dropping each study, report the swing) + influence flags. SPECIALIZE' +
      ' backend/engines/PyMARE/ IN PLACE: add pymare/papertrail_bayesian.py (reference cross-check emitting the same' +
      ' posterior/predictive numbers + PAPERTRAIL.md). app/api/meta/bayesian/route.ts (POST { studies[] RR/HR/OR ->' +
      ' log-effects } -> posterior + predictive interval) and app/api/meta/sensitivity/route.ts (POST { studies[] }' +
      ' -> leave-one-out table + max swing). Public, rate-limited, deterministic, reproducible from inputs. READ' +
      ' lib/metaAnalysis.ts + lib/metaEstimators.ts + lib/publicationBias.ts (StudyEffect shape) first; reuse the' +
      ' existing pooling, add new modules — do not edit metaAnalysis.ts.',
  },
  {
    key: 'submission',
    body:
      'REGULATORY SUBMISSION BUNDLE. NEW lib/submission/bundle.ts + lib/submission/schemas.ts: assembleSubmissionBundle' +
      ' (pool, orgId, { verificationIds?[], evidenceReportId? }) that composes a regulator-facing export MANIFEST:' +
      ' the verdicts, the deterministic numbers (effect sizes / GRADE), the grounded spans, and a chain-of-custody' +
      ' summary (source ids + versions + hashes) into a structured, auditable bundle (a CTD/eCTD-style section map:' +
      ' summary-of-findings, methods, evidence table, provenance appendix). Deterministic assembly, NO LLM; every' +
      ' number/span traces to its source; honest gaps listed (what is missing) rather than fabricated. app/api/' +
      'submission/bundle/route.ts (withOrg, requireRole editor -> returns the manifest; ?format=json download).' +
      ' app/console/submission/page.tsx + _components (pick verifications/report -> preview the bundle sections +' +
      ' export). READ lib/dossier/* + lib/evidenceReportExport.ts + lib/reportExport*.ts + lib/api/handler.ts (withOrg)' +
      ' first; reuse existing export helpers, do not edit them.',
  },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['group', 'filesCreated'],
  properties: {
    group: { type: 'string' },
    filesCreated: { type: 'array', items: { type: 'string' } },
    filesEdited: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    followups: { type: 'array', items: { type: 'string' } },
  },
}

phase('Build')
const built = (await parallel(
  GROUPS.map((g) => () =>
    agent(
      [
        'Build ONE Later-tier PaperTrail feature: ' + g.key + '.',
        '',
        CONTRACT,
        '',
        'YOUR PART:',
        g.body,
        '',
        'Ship complete, working, typed code (no TODOs, no any). Do NOT run npm/tsc. Edit ONLY the files your part',
        'owns; make edits to existing core files surgical + additive. Return files created + edited.',
      ].join('\n'),
      { label: 'build:' + g.key, phase: 'Build', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review PaperTrail Later tier. READ lib/kg/learnedLinkPredict.ts, app/api/kg/predict/learned,',
    'db/migrations/0068_kg-embeddings.sql, lib/mechanism/context.ts, app/api/mechanism/context-filter,',
    'lib/metaBayesian.ts, lib/metaSensitivity.ts, app/api/meta/bayesian, app/api/meta/sensitivity,',
    'lib/submission/*, app/api/submission/bundle, the new console pages, and the backend/engines/{pykeen,indra,PyMARE}',
    'specializations. Check: NO LLM in any numeric/training/scoring path; embeddings/training deterministic (fixed',
    'seed, no Math.random / no Date.now in the math); grounding enforced where source spans are quoted; migration',
    'idempotent + numbered 0068 (unique); routes rate-limited + zod-validated + never log text; submission bundle',
    'is org-scoped (requireRole editor) and traces every number/span; deterministic reproducibility; obvious',
    'TypeScript build risks. Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:later', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Later tier built: ' + built.length + ' features; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }
