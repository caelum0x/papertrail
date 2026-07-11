export const meta = {
  name: 'expand-backend-engines',
  description: 'Specialize 6 more OSS engines in place (MiniCheck, Loki, paper-qa, ASReview, BioCypher, STORM) + native TS + API',
  phases: [
    { title: 'Build', detail: 'six engine specializations in parallel, disjoint files' },
    { title: 'Verify', detail: 'adversarial review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL — expand backend/. We OWN the vendored OSS (permissive licenses). Specialize each engine IN PLACE:',
  'add PaperTrail-native module(s) UNDER backend/engines/<engine>/ (a papertrail_*.py, stdlib-only, standalone,',
  'argparse CLI reading JSON on --arg or stdin, printing JSON to stdout, honest {"error":...}+exit 2 on bad input,',
  'py_compile-clean) + a PAPERTRAIL.md documenting it as a PaperTrail-native specialization and the field-for-field',
  'mapping to a native TS module in lib/. backend/engines is EXCLUDED from the Next build (zero TS impact).',
  '',
  'Then wire it into our stack: a native TS lib/ module (deterministic where numeric — mirror the Python) + a',
  'PUBLIC compute route following app/api/bio/genetic-association/route.ts (runtime nodejs, IP checkRateLimit, zod',
  'safeParse, ok/fail envelope from @/lib/api/response, try/catch, never log claim/source text — ids/counts only).',
  '',
  'MOAT RULES: NO LLM in any numeric/scoring/ranking/verdict path — deterministic math + rules decide; Claude only',
  'for a language step (extraction/judgment) that then gets GROUNDED via lib/grounding.ts locateSpan (drop + count',
  'ungroundable). Prefer honest insufficient over a forced answer. TS strict, no any, no TODOs.',
  '',
  'FILE OWNERSHIP IS DISJOINT (touch ONLY your engine dir + your lib module + your route(+migration); do NOT touch',
  'middleware.ts, layout.tsx, mcp/src/server.ts, other engines, or another part\'s files). READ lib/grounding.ts,',
  'lib/api/handler.ts, lib/api/response.ts, and the named existing modules for each part before writing.',
].join('\n')

const GROUPS = [
  {
    key: 'minicheck',
    body:
      'MiniCheck — NEGATION-AWARE entailment + a negative_supported verdict for ABSENCE claims ("Drug X does NOT' +
      ' cause hepatotoxicity"). backend/engines/MiniCheck/papertrail_negation.py (detect claim polarity; for a' +
      ' negative claim, "supported" means the source shows ABSENCE/no-association, not presence) + PAPERTRAIL.md.' +
      ' lib/grounding/negationEntailment.ts — verifyAbsenceClaim(claim, sourceText, {llm?}): detect polarity' +
      ' deterministically (negation cue lexicon), then a grounded entailment (reuse the existing entailment pattern' +
      ' in lib/grounding/entailment.ts as the model call, but INVERT for negative claims), returning' +
      ' supported | negative_supported | refuted | nei + grounded supporting span (dropped if ungroundable). NO LLM' +
      ' decides the polarity or the final label mapping — only the sentence-level support judgment, which is grounded.' +
      ' app/api/verify/absence-claim/route.ts (POST { claim, source_text }). READ lib/grounding/entailment.ts first.',
  },
  {
    key: 'loki',
    body:
      'OpenFactVerification/Loki — CLAIM-FRAME on-topic RERANKER (cuts retrieval noise 40-60%). backend/engines/' +
      'OpenFactVerification/papertrail_rerank.py (extract the claim frame: subject / predicate / object / modifiers' +
      ' like "in pregnant women"; deterministically score each candidate source for on-topic frame overlap 0..1) +' +
      ' PAPERTRAIL.md. lib/agents/contextualRank.ts — rankByClaimFrame(claim, sources[], {llm?}): deterministic' +
      ' frame-overlap score (token/entity overlap of subject+object+modifiers vs each source) PLUS an optional' +
      ' single grounded Claude relevance pass; drop sources below a documented threshold; NO LLM decides the final' +
      ' numeric rank (it only tags relevance, then rule-combined). app/api/retrieval/rerank/route.ts (POST { claim,' +
      ' sources: [{id, text}] } -> ranked sources with scores + which were dropped). READ lib/retrieval/hybrid.ts first.',
  },
  {
    key: 'paperqa',
    body:
      'paper-qa — SOURCE-QUALITY TIERS + evidence-chain. backend/engines/paper-qa/papertrail_source_quality.py' +
      ' (deterministically tier a source from metadata: retracted? (Retraction Watch id present) -> untrusted;' +
      ' peer-reviewed journal + citations -> higher tier; preprint -> lower; open-access flag; assign tier A/B/C/D' +
      ' with a documented rubric) + PAPERTRAIL.md. lib/paperqa/sourceQuality.ts — scoreSourceQuality(meta):' +
      ' deterministic tier + a quality-weight in [0,1] usable to down-weight low-tier sources in synthesis; a' +
      ' retracted flag hard-caps to untrusted. NO LLM. app/api/sources/quality-tier/route.ts (POST { sources:' +
      ' [{id, journal?, year?, citations?, is_preprint?, is_open_access?, retracted?}] } -> per-source tier +' +
      ' weight + rationale). READ lib/paperqa/ (existing) + lib/sources/* first.',
  },
  {
    key: 'asreview',
    body:
      'ASReview — ENSEMBLE SCREENING (inclusion + quality + risk-of-bias in ONE pass) + boundary provenance.' +
      ' backend/engines/asreview/papertrail_ensemble.py (deterministic TF-IDF + multinomial Naive Bayes ensemble' +
      ' across THREE label axes — include/exclude, high/low quality, low/high RoB — ranking abstracts by a combined' +
      ' priority; document the boundary that decides the ranking) + PAPERTRAIL.md. lib/screening/ensemble.ts —' +
      ' native TS mirror (reuse lib/screening/activeLearning.ts TF-IDF+NB, do NOT edit it): ensembleScreen(labeled,' +
      ' unlabeled) -> per-abstract {includeScore, qualityScore, robScore, priority, decidingAxis}. Deterministic,' +
      ' NO LLM. app/api/screening/ensemble/route.ts (POST { labeled:[{text,include,quality?,rob?}], unlabeled:' +
      '[{id,text}] } -> ranked). READ lib/screening/activeLearning.ts first.',
  },
  {
    key: 'biocypher',
    body:
      'BioCypher — BRING-YOUR-OWN-KG CSV import with Biolink domain/range validation. backend/engines/biocypher/' +
      'papertrail_byokg.py (parse a nodes CSV + edges CSV; validate each edge predicate against a Biolink-style' +
      ' domain/range table so an ill-typed edge is REJECTED with a reason, not silently coerced) + PAPERTRAIL.md.' +
      ' migration 0071_kg-import.sql (idempotent): kg_import_batches(id uuid pk default gen_random_uuid(), org_id' +
      ' uuid not null references orgs(id) on delete cascade, node_count int, edge_count int, rejected_count int,' +
      ' created_by uuid, created_at timestamptz default now()); index (org_id, created_at desc). lib/kg/byoKg.ts —' +
      ' validateAndImportKg(pool, orgId, {nodes[], edges[]}): reuse lib/kg/biolink.ts typing (do NOT edit it) to' +
      ' validate domain/range; insert valid nodes/edges into the existing kg_nodes/kg_edges; record a batch;' +
      ' return {imported, rejected:[{edge, reason}]}. NO LLM. app/api/kg/import/route.ts (withOrg editor: POST' +
      ' { nodes[], edges[] }). READ lib/kg/biolink.ts + the kg_nodes/kg_edges migration (0052) + lib/api/handler.ts first.',
  },
  {
    key: 'storm',
    body:
      'STORM — STRUCTURED DEBATE document for MIXED verdicts (Claim / Best-Case / Critique / Response). backend/' +
      'engines/storm/papertrail_debate.py (given a claim + supporting and refuting source snippets, assemble a' +
      ' structured multi-perspective debate skeleton deterministically from the provided evidence — it ORGANIZES,' +
      ' it does not invent) + PAPERTRAIL.md. lib/synthesis/debate.ts — buildDebate(claim, supporting[], refuting[],' +
      ' {llm?}): deterministic structure (sections: claim, best-case-for with grounded supporting quotes,' +
      ' critique with grounded refuting quotes, synthesis stance); Claude may only WRITE the connective prose,' +
      ' but every evidence quote must be grounded via locateSpan (drop ungroundable) and no verdict/number is LLM-' +
      'decided. app/api/synthesis/debate/route.ts (POST { claim, supporting:[{id,text}], refuting:[{id,text}] } ->' +
      ' the structured debate + grounded quotes + droppedUngrounded). READ lib/synthesis/* + lib/grounding.ts first.',
  },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['group', 'filesCreated'],
  properties: {
    group: { type: 'string' },
    filesCreated: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    followups: { type: 'array', items: { type: 'string' } },
  },
}

phase('Build')
const built = (await parallel(
  GROUPS.map((g) => () =>
    agent(
      [
        'Specialize ONE OSS engine in place + wire it natively: ' + g.key + '.',
        '',
        CONTRACT,
        '',
        'YOUR PART:',
        g.body,
        '',
        'Ship complete, working, typed code (no TODOs, no any). Do NOT run npm/tsc. Touch ONLY your engine dir +',
        'your lib module + your route (+ migration for biocypher). Return the files you created.',
      ].join('\n'),
      { label: 'build:' + g.key, phase: 'Build', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review the PaperTrail backend-engine expansion. READ backend/engines/{MiniCheck,',
    'OpenFactVerification,paper-qa,asreview,biocypher,storm}/papertrail_*.py, lib/grounding/negationEntailment.ts,',
    'lib/agents/contextualRank.ts, lib/paperqa/sourceQuality.ts, lib/screening/ensemble.ts, lib/kg/byoKg.ts,',
    'lib/synthesis/debate.ts, their app/api routes, and db/migrations/0071_kg-import.sql. Check: NO LLM in any',
    'numeric/scoring/ranking/verdict path; grounding enforced where quotes are surfaced (verbatim + drop);',
    'org-scoped routes filter org_id + use withOrg/requireRole (kg/import); public routes rate-limited + zod-',
    'validated + never log text; migration 0071 idempotent + uniquely numbered; each engine has a PAPERTRAIL.md',
    'and its Python is standalone/stdlib-only; obvious TypeScript build risks (bad imports, wrong signatures).',
    'Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:backend', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Backend expansion: ' + built.length + ' engines specialized; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }
