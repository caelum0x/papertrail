export const meta = {
  name: 'build-next-tier',
  description: 'Next tier: contradiction atlas, subgroup+pub-bias hardening, RAG-fusion+sufficiency, immutable provenance chain',
  phases: [
    { title: 'Build', detail: 'four moat-deepening features in parallel, disjoint files' },
    { title: 'Verify', detail: 'adversarial review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL NEXT TIER. See docs/roadmap-realworld.md ("Next"). Deepen the deterministic + grounded + auditable',
  'moat and SPECIALIZE more OSS engines IN PLACE (edit backend/engines/<engine>/). This is a live platform at',
  'https://papertrail-topaz-phi.vercel.app.',
  '',
  'MOAT RULES (non-negotiable): NO LLM in any numeric/verdict/scoring path. Deterministic rules decide; Claude is',
  'only for language steps (extraction, per-source judgment) that then get grounded. Every quoted span/number must',
  'be a verbatim substring of the source (lib/grounding.ts locateSpan) — drop + count anything ungroundable.',
  'Prefer honest "insufficient"/"no_support_found" over a forced answer. Never log claim/patient/source text.',
  '',
  'STACK: Next.js 16, TS strict, Postgres/Neon (getPool from @/lib/db, parameterized $1 SQL), public compute routes',
  'follow app/api/bio/genetic-association/route.ts (runtime nodejs, IP checkRateLimit, zod safeParse, ok/fail',
  'envelope, try/catch). Additive, idempotent migrations. Make edits to EXISTING core files SURGICAL + additive',
  '(add a function/hook/optional call — never rewrite the file); read the file first. Console pages: theme tokens',
  'bg-paper/text-ink/text-accent/border-ink/15, read app/console/hypotheses/page.tsx for the client pattern.',
  '',
  'FILE OWNERSHIP IS DISJOINT (do not touch another part\'s files, middleware.ts, layout.tsx, or mcp/src/server.ts):',
  '  contradiction  -> NEW lib/contradiction/* + app/api/verify/contradiction-resolve + console + backend/engines/Valsci/ + backend/engines/indra/',
  '  hardening      -> OWNS edits to lib/structuredVerification.ts + lib/grade.ts (surgical) + NEW routes',
  '  retrieval      -> OWNS edits to lib/retrieval/hybrid.ts + lib/evidencePipeline.ts (surgical) + backend/engines/R2R/ + NEW route',
  '  provenance     -> NEW migration 0067 + lib/provenance/* + OWNS additive edit to lib/compliance/chain.ts + NEW route + console',
].join('\n')

const GROUPS = [
  {
    key: 'contradiction',
    body:
      'QUANTITATIVE CONTRADICTION ATLAS. When cross-source verification returns "mixed" (lib/scieval/valsci.ts),' +
      ' route both sides to a DETERMINISTIC conflict explainer that attributes the reversal to population / dose /' +
      ' tissue / follow-up differences, using INDRA belief scores + trial design features (deterministic feature' +
      ' extraction; Claude may only tag the candidate dimension, then it is rule-scored). SPECIALIZE ENGINES IN' +
      ' PLACE: backend/engines/Valsci/papertrail_conflict.py (port Valsci contradiction-resolution loop into' +
      ' resolution_category + primary_hypothesis + supporting_count) + backend/engines/indra/grounding_hook.py' +
      ' (surface RefContext tissue/species/assay + belief into the explainer) + PAPERTRAIL.md each. NEW TS:' +
      ' lib/contradiction/atlas.ts (orchestrator, injectable deps, reuses lib/scieval + lib/mechanism belief) +' +
      ' lib/contradiction/schemas.ts. NEW route app/api/verify/contradiction-resolve/route.ts (POST claim +' +
      ' sources array -> per-side grounded verdict + deterministic conflict attribution). NEW console page' +
      ' app/console/contradiction/page.tsx + _components (conflict map: supporting vs refuting with the attributed' +
      ' dimension + grounded quotes). READ lib/scieval/valsci.ts, lib/mechanism/assemble.ts, lib/grounding.ts first.',
  },
  {
    key: 'hardening',
    body:
      'SUBGROUP + PUBLICATION-BIAS VERIFICATION HARDENING. Two surgical, additive wirings + two routes. (1) Wire' +
      ' lib/subgroupAnalysis.ts into lib/structuredVerification.ts: add a deterministic check that flags a claim' +
      ' whose effect matches a SUBGROUP (pre-specified vs post-hoc, interaction p-value) but is stated as the' +
      ' primary/whole-population effect as subgroup_cited_as_primary. Add it as a NEW exported function +' +
      ' one optional call site; do NOT rewrite the file. (2) Wire lib/publicationBias.ts (Egger + trim-and-fill)' +
      ' into lib/grade.ts so detected funnel asymmetry AUTO-DOWNGRADES GRADE certainty one step (a new downgrade' +
      ' domain publication_bias) — additive, behind the existing GRADE inputs. NEW routes:' +
      ' app/api/verify/subgroup-check/route.ts (POST claim + subgroups array) and' +
      ' app/api/evidence-report/meta-bias-analysis/route.ts (POST studies array -> Egger + trim-and-fill +' +
      ' resulting GRADE downgrade). Public, rate-limited, deterministic, no LLM. READ lib/structuredVerification.ts,' +
      ' lib/grade.ts, lib/subgroupAnalysis.ts, lib/publicationBias.ts first.',
  },
  {
    key: 'retrieval',
    body:
      'QUERY EXPANSION (RAG-FUSION) + EVIDENCE-SUFFICIENCY LOOP. SPECIALIZE backend/engines/R2R/ IN PLACE: add' +
      ' r2r/papertrail_rag_fusion.py (biomedical sub-query decomposition into efficacy/safety/mechanism/subgroup' +
      ' facets + Reciprocal Rank Fusion) + PAPERTRAIL.md. Surgically + additively extend lib/retrieval/hybrid.ts' +
      ' with a NEW exported ragFusionRetrieve() that decomposes a query into biomedical facets, runs the existing' +
      ' hybrid retrieval per facet, and fuses with RRF (deterministic) — do NOT change the existing hybrid export.' +
      ' Surgically extend lib/evidencePipeline.ts with a NEW exported evidenceSufficiency() gate (deterministic:' +
      ' at least 3 studies, participants >= 100, I2 < 75 percent, contradictions resolved) to decide whether' +
      ' synthesis has enough evidence to conclude vs needs more (returns sufficient + reasons array); add it as a' +
      ' new function, not a rewrite. NEW route app/api/research/expand-query/route.ts (POST query -> facets +' +
      ' fused sources + sufficiency verdict). READ lib/retrieval/hybrid.ts, lib/evidencePipeline.ts, lib/embeddings.ts first.',
  },
  {
    key: 'provenance',
    body:
      'IMMUTABLE PROVENANCE + SNAPSHOT VERSIONING. migration 0067_provenance-chain.sql (idempotent): evidence_'+
      'source_versions(id uuid pk, source_id uuid references sources(id) on delete cascade, source_version text,'+
      ' snapshot_date timestamptz, doi text, pmid text, content_hash text, recorded_at timestamptz default now())'+
      ' + index on (source_id). lib/provenance/chainOfCustody.ts: buildChainOfCustody(pool, verificationId) that'+
      ' assembles, for a verification, every grounded span with { source_id, doi/pmid, source_version, snapshot_'+
      'date, verification_id, chain_of_custody_hash } — the hash is a deterministic sha256 over the ordered'+
      ' provenance tuple (NO Date.now in the hash). ADDITIVELY extend lib/compliance/chain.ts with a helper to'+
      ' anchor a chain-of-custody hash into the WORM chain (new exported function; do not change existing ones).'+
      ' NEW route app/api/audit-chain/verification/[id]/route.ts (withOrg viewer -> reconstruct the exact'+
      ' provenance state at export). NEW console page app/console/audit/custody/page.tsx (look up a verification'+
      ' id -> its chain-of-custody table + verify-hash button). READ lib/compliance/chain.ts, lib/grounding.ts,'+
      ' db/migrations/0001_foundation.sql (sources) first.',
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
        'Build ONE Next-tier PaperTrail feature: ' + g.key + '.',
        '',
        CONTRACT,
        '',
        'YOUR PART:',
        Array.isArray(g.body) ? g.body.join('') : g.body,
        '',
        'Ship complete, working, typed code (no TODOs, no any). Do NOT run npm/tsc. Edit ONLY the files your part',
        'owns (per FILE OWNERSHIP); make edits to existing core files surgical + additive. Return files created + edited.',
      ].join('\n'),
      { label: 'build:' + g.key, phase: 'Build', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review PaperTrail Next tier. READ lib/contradiction/*, app/api/verify/contradiction-resolve,',
    'lib/structuredVerification.ts + lib/grade.ts (the additive subgroup + publication-bias wirings),',
    'app/api/verify/subgroup-check, app/api/evidence-report/meta-bias-analysis, lib/retrieval/hybrid.ts +',
    'lib/evidencePipeline.ts (ragFusion + sufficiency additions), app/api/research/expand-query,',
    'db/migrations/0067_provenance-chain.sql, lib/provenance/chainOfCustody.ts, lib/compliance/chain.ts (additive',
    'helper), app/api/audit-chain/verification/[id], and the new console pages + backend/engines/{Valsci,indra,R2R}',
    'specializations. Check: NO LLM in any numeric/verdict/scoring path; grounding enforced (verbatim + drop',
    'ungroundable); edits to existing files are additive (existing exports unchanged); migration idempotent +',
    'correctly numbered 0067; routes rate-limited + zod-validated + never log text; no Date.now in any content',
    'hash; deterministic thresholds are sensible; obvious TypeScript build risks. Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:next', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Next tier built: ' + built.length + ' features; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }
