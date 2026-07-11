export const meta = {
  name: 'expand-backend-final3',
  description: 'Specialize the last 3 OSS engines in place (MultiVerS, open_deep_research, pytrials) — completes all 17',
  phases: [
    { title: 'Build', detail: 'three engine specializations in parallel, disjoint files' },
    { title: 'Verify', detail: 'adversarial review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL — finish expanding backend/. We OWN the vendored OSS (permissive). Specialize each engine IN PLACE:',
  'add PaperTrail-native module(s) UNDER backend/engines/<engine>/ (a papertrail_*.py, stdlib-only, standalone,',
  'argparse CLI reading JSON on --arg/stdin, printing JSON to stdout, {"error":...}+exit 2 on bad input,',
  'py_compile-clean) + a PAPERTRAIL.md (mapping to the native TS module). backend/engines is EXCLUDED from the',
  'Next build (zero TS impact).',
  '',
  'Then wire natively: a lib/ TS module (deterministic where numeric — mirror the Python) + a PUBLIC compute route',
  'following app/api/bio/genetic-association/route.ts (runtime nodejs, IP checkRateLimit, zod safeParse, ok/fail',
  'from @/lib/api/response, try/catch, never log claim/source text — ids/counts only).',
  '',
  'MOAT: NO LLM in any numeric/scoring/ranking/verdict path — deterministic decides; Claude only for a language',
  'step that gets GROUNDED via lib/grounding.ts locateSpan (drop + count ungroundable). Honest insufficient over a',
  'forced answer. TS strict, no any, no TODOs. FILE OWNERSHIP DISJOINT: touch ONLY your engine dir + your lib',
  'module + your route; do NOT touch middleware.ts, layout.tsx, mcp/src/server.ts, other engines, or another',
  'part\'s files.',
].join('\n')

const GROUPS = [
  {
    key: 'multivers',
    body:
      'MultiVerS — CROSS-SOURCE label AGGREGATION feeding the contradiction atlas (extend beyond single-abstract' +
      ' SUPPORTS/REFUTES/NEI to a multi-source AGGREGATE verdict). backend/engines/multivers/papertrail_aggregate.py' +
      ' (given per-source {label, confidence}, deterministically aggregate: weighted tally -> supported / refuted /' +
      ' mixed / insufficient, with the tally + net direction) + PAPERTRAIL.md. lib/scieval/crossSourceAggregate.ts' +
      ' — aggregateCrossSource(perSource[]): deterministic weighted aggregation (reuse lib/scieval/* label vocab if' +
      ' present; do NOT edit it) -> { verdict, supportCount, refuteCount, neiCount, netConfidence, mixed }. NO LLM.' +
      ' app/api/scieval/aggregate/route.ts (POST { sources:[{id,label,confidence?}] } -> aggregate verdict + tally).' +
      ' READ lib/scieval/verify.ts + lib/scieval/valsci.ts first.',
  },
  {
    key: 'iterative',
    body:
      'open_deep_research — ITERATIVE evidence-sufficiency research LOOP (plan -> assess sufficiency -> widen if' +
      ' insufficient, BOUNDED rounds). backend/engines/open_deep_research/papertrail_iterative.py (a deterministic' +
      ' state machine: given accrued evidence stats per round, decide continue|stop with the reason and next widen-' +
      ' action; hard round cap) + PAPERTRAIL.md. lib/research/iterativeLoop.ts — planIterativeRounds(rounds[],' +
      ' opts): deterministic loop that reuses lib/evidencePipeline.ts evidenceSufficiency (do NOT edit it) to decide,' +
      ' each round, sufficient (stop) vs insufficient (emit a concrete widen action: broaden query / add facet /' +
      ' raise limit), capped at MAX_ROUNDS=3. NO LLM in the stop/continue decision. app/api/deep-research/iterative/' +
      'route.ts (POST { rounds:[{k, participants, iSquared?, openContradictions?}] } -> per-round decision + final' +
      ' stop reason). READ lib/evidencePipeline.ts (evidenceSufficiency) + lib/research/orchestrator.ts first.',
  },
  {
    key: 'pytrials',
    body:
      'pytrials — ELIGIBILITY-criteria structured parsing + DESIGN-CREDIBILITY priors. backend/engines/pytrials/' +
      'papertrail_design.py (parse a trial eligibility block into inclusion[]/exclusion[] gates via heading/bullet' +
      ' rules; score design credibility deterministically from structured fields: randomized? blinded? enrollment' +
      ' size band? -> a credibility tier + prior weight) + PAPERTRAIL.md. lib/sources/trialDesign.ts —' +
      ' parseEligibility(text) (deterministic split) + scoreDesignCredibility({randomized, blinding, enrollment,' +
      ' phase}) -> { tier, priorWeight, factors[] }; NO LLM. app/api/trials/design/route.ts (POST { eligibility?,' +
      ' design?:{randomized,blinding,enrollment,phase} } -> parsed gates + credibility). READ lib/sources/' +
      'clinicaltrials.ts + lib/trialMatcher/eligibility.ts first (do NOT edit them).',
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
        'your lib module + your route. Return the files you created.',
      ].join('\n'),
      { label: 'build:' + g.key, phase: 'Build', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review the final PaperTrail backend expansion. READ backend/engines/{multivers,',
    'open_deep_research,pytrials}/papertrail_*.py, lib/scieval/crossSourceAggregate.ts, lib/research/iterativeLoop.ts,',
    'lib/sources/trialDesign.ts, and their app/api routes. Check: NO LLM in any numeric/scoring/verdict path;',
    'public routes rate-limited + zod-validated + never log text; each engine has a PAPERTRAIL.md + standalone',
    'stdlib-only Python; the iterative loop is bounded (MAX_ROUNDS) and its stop/continue is deterministic; no edits',
    'to reused core files; obvious TypeScript build risks (bad imports, wrong signatures, RbacError casts).',
    'Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:final3', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Final backend expansion: ' + built.length + ' engines; ' + (review.issues ? review.issues.length : 0) + ' issues flagged. All 17 OSS engines now specialized.')
return { built, review }
