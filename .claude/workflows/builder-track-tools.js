export const meta = {
  name: 'builder-track-tools',
  description: 'Make the 3 named-user tools demo-ready (self-serve, built to last): lab notebook, trial matcher, claim verification',
  phases: [
    { title: 'Assess', detail: 'read each tool end-to-end; find what blocks a named user' },
    { title: 'Build', detail: 'make each tool demo-ready (disjoint files per tool)' },
    { title: 'Verify', detail: 'adversarial "can the named user finish without help?" review' },
  ],
}

const CREED = [
  'PAPERTRAIL — Anthropic x Gladstone "Built Beyond the Bench" (Builder Track). The bar: a NAMED',
  'user can run this tool end-to-end WITHOUT the builder in the room, and it is built to OUTLAST the',
  'week (persists, no dead ends, honest empty/loading/error states). Not a demo script — working',
  'software. Judges are translational-research staff (disease-focused labs), not generic biotech.',
  '',
  'DEMO-READY CHECKLIST for your tool:',
  '  1. HAPPY PATH WORKS: the core job completes with a real, useful result (not a stub/placeholder).',
  '  2. ONE-CLICK EXAMPLE: a prominent "Try an example" that loads realistic, domain-accurate sample',
  '     input CLIENT-SIDE (no DB seeding needed) so a first-time user gets value in one click.',
  '  3. STATES: clear loading, empty, and error states with recovery — never a blank screen or a',
  '     silent failure. If an upstream LLM/API is unavailable, show an honest degraded message, not a',
  '     crash (the app Anthropic key may be usage-capped during judging — the tool must still render',
  '     and explain, never white-screen).',
  '  4. GUIDANCE: a one-line "what this does / who it is for" header + inline hints so a stranger',
  '     understands it without a tour.',
  '  5. RESULT QUALITY: the output is genuinely useful to the named user and shows its reasoning',
  '     (e.g. WHY a trial matched, WHERE a claim is supported) — provenance over a bare answer.',
  '',
  'RULES: TS strict, no any, no TODOs, no placeholder text left in the UI. Match existing PaperTrail',
  'UI conventions (Tailwind, the console look). Do NOT weaken the deterministic/grounding moat. Touch',
  'ONLY your tool\'s files (listed below) — do NOT edit shared core (lib/agents/*, lib/moa/*,',
  'lib/grounding.ts, lib/claude.ts, middleware.ts, app/console/layout.tsx) or another tool\'s files.',
  'If a genuinely-needed change is in a shared file, describe it in followups instead of editing it.',
].join('\n')

const TOOLS = [
  {
    key: 'lab-notebook',
    user: 'a wet-lab scientist at the bench',
    body:
      'LAB NOTEBOOK COMPANION — turns rough bench notes / dictated memos into STRUCTURED, SEARCHABLE' +
      ' experiment records (protocol, reagents, samples, conditions, outcomes auto-tagged). Own dirs:' +
      ' app/console/lab-notebook/** , lib/labNotebook/** , app/api/lab-notebook/**. READ' +
      ' lib/labNotebook/structure.ts + schemas.ts + repository.ts and the page first. Make it demo-ready:' +
      ' a scientist pastes/【dictates】messy notes ("ran western blot, 30ug lysate, anti-Tau 1:1000 o/n,' +
      ' 2 KO + 2 WT, band ~50kDa gone in KO") and gets a clean structured entry with tagged reagents/' +
      ' samples/outcome + it is saved and searchable. Add a one-click realistic example, states, and a' +
      ' clear structured-vs-raw view. Keep the structuring grounded to what was written (no invented' +
      ' reagents).',
  },
  {
    key: 'trial-matcher',
    user: 'a clinical research coordinator',
    body:
      'TRIAL MATCHER — free-text patient notes -> eligible ClinicalTrials.gov trials, with the' +
      ' inclusion/exclusion reasoning shown FOR EVERY match (this per-criterion reasoning is the whole' +
      ' point). Own dirs: app/console/trial-matcher/** , lib/trialMatcher/** , app/api/trial-matcher/**.' +
      ' READ lib/trialMatcher/{eligibility,match,patientProfile,schemas}.ts and the page first. Make it' +
      ' demo-ready: a coordinator pastes a patient vignette ("62F, HER2+ metastatic breast cancer, prior' +
      ' trastuzumab, ECOG 1, adequate organ function") and gets ranked candidate trials each showing which' +
      ' inclusion criteria are MET vs which exclusions may apply, with the evidence from the note. Add a' +
      ' one-click example patient, states, and a clear per-match criteria breakdown. Show honest "cannot' +
      ' determine from note" for unstated criteria rather than guessing.',
  },
  {
    key: 'verify',
    user: 'a medical-affairs / translational reviewer',
    body:
      'CLAIM VERIFICATION — paste an efficacy/safety claim -> the primary source is checked and a grounded' +
      ' verdict + trust score + citation trail is returned (PaperTrail\'s core, where it beats a plain' +
      ' LLM). Own: app/console/verify/** ONLY (the page + its components). Use the EXISTING /api/verify/text' +
      ' (and /api/moa/verify-claim for the deep "mixture" option) routes — do NOT edit the verify engine' +
      ' libs. READ app/console/verify/page.tsx and the shape /api/verify/text returns first. Make it demo-' +
      ' ready for a reviewer: prominent claim box + one-click example claims (one clearly-accurate, one' +
      ' subtly-overstated like "reduced events by 37%" vs a source HR 0.75 = 25%), a crisp verdict card' +
      ' (accurate / magnitude-overstated / etc.) with the trust score, the flagged claim-vs-source spans' +
      ' highlighted, and a copyable citation. Clear degraded state if the LLM key is capped (still show' +
      ' the deterministic reconcile result). Do NOT touch the shared verify engine libs.',
  },
]

const ASSESS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tool', 'worksToday', 'blockers'],
  properties: {
    tool: { type: 'string' },
    worksToday: { type: 'string', description: 'what a named user CAN do end-to-end today' },
    blockers: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'gap', 'fix'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'polish'] },
        gap: { type: 'string' }, fix: { type: 'string' } } } },
  },
}

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tool', 'changed', 'demoScript'],
  properties: {
    tool: { type: 'string' },
    changed: { type: 'array', items: { type: 'string' } },
    demoScript: { type: 'string', description: 'the exact click-path a named user follows to get value' },
    followups: { type: 'array', items: { type: 'string' } },
  },
}

phase('Assess')
// Pipeline each tool: assess (read-only) -> build demo-ready. No barrier between tools.
const results = await pipeline(
  TOOLS,
  (t) =>
    agent(
      [
        'ASSESS the PaperTrail tool "' + t.key + '" for ' + t.user + '. READ its full flow (page + lib +',
        'routes). What can the named user actually do end-to-end today, and what BLOCKS them from finishing',
        'without the builder? Be concrete and grounded in the code.',
        '',
        CREED,
        '',
        'YOUR TOOL:',
        t.body,
      ].join('\n'),
      { label: 'assess:' + t.key, phase: 'Assess', agentType: 'Explore', schema: ASSESS_SCHEMA }
    ),
  (assessment, t) =>
    agent(
      [
        'BUILD "' + t.key + '" to demo-ready for ' + t.user + ', fixing the blockers from the assessment.',
        '',
        CREED,
        '',
        'YOUR TOOL:',
        t.body,
        '',
        'ASSESSMENT (blockers to resolve, worst first):',
        JSON.stringify(assessment, null, 2),
        '',
        'Implement complete, working, typed code. Touch ONLY your tool\'s files. Do NOT run npm/tsc/git.',
        'Return the files you changed + the exact demo click-path a named user follows.',
      ].join('\n'),
      { label: 'build:' + t.key, phase: 'Build', schema: BUILD_SCHEMA }
    )
)

const built = results.filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially verify the 3 PaperTrail named-user tools are DEMO-READY (usable without the builder).',
    'For each of app/console/{lab-notebook,trial-matcher,verify}: open the page + the routes/lib it calls',
    'and check — (1) is there a one-click realistic example? (2) does the happy path produce a real, useful,',
    'reasoned result (not a stub)? (3) are loading/empty/error states present, including an honest degraded',
    'state if the LLM key is capped (no white-screen)? (4) TypeScript build risks (bad imports, any, wrong',
    'route shapes, missing awaits)? (5) any leftover placeholder/TODO text in the UI? Report concrete',
    'blocking issues per tool with file + fix.',
  ].join('\n'),
  { label: 'verify:tools', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false, required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'tool', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'polish'] },
        tool: { type: 'string' }, file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Builder-track tools: ' + built.length + ' built; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }
