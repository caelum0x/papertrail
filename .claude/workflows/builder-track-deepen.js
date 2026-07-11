export const meta = {
  name: 'builder-track-deepen',
  description: 'Deepen the 3 named-user tools (reasoning depth + polish fixes) and add a reviewer walkthrough landing',
  phases: [
    { title: 'Deepen', detail: 'one agent per tool: additive reasoning depth + the flagged polish' },
    { title: 'Landing', detail: 'a reviewer walkthrough page linking the 3 named journeys' },
    { title: 'Verify', detail: 'adversarial demo-readiness + no-regression check' },
  ],
}

const CREED = [
  'PAPERTRAIL — Anthropic x Gladstone "Built Beyond the Bench" Builder Track. The 3 named-user tools',
  'are ALREADY demo-ready (one-click example, degraded states, real results). This round DEEPENS them',
  'and must NOT regress the working happy path. ADDITIVE only: strengthen the "show WHY" (provenance,',
  'reasoning) that judges reward, and fix the small flagged polish. Keep the deterministic/grounding',
  'moat (grounded spans stay verbatim; no invented data). TS strict, no any, no TODOs, no placeholder',
  'text left in the UI. Match existing Tailwind/console conventions. Touch ONLY your tool\'s files',
  '(listed) — do NOT edit shared core (lib/agents/*, lib/moa/*, lib/grounding.ts, lib/claude.ts,',
  'middleware.ts, app/console/layout.tsx) or another tool\'s files. If the app Anthropic key is usage-',
  'capped, the tool must still render + explain (never white-screen).',
].join('\n')

const TOOLS = [
  {
    key: 'lab-notebook',
    body:
      'LAB NOTEBOOK (wet-lab scientist). Own: app/console/lab-notebook/** , lib/labNotebook/** ,' +
      ' app/api/lab-notebook/**. DEEPEN: add a deterministic "reproducibility check" on the structured' +
      ' record — flag missing-but-expected protocol details (e.g. antibody with no dilution, reagent with' +
      ' no vendor/cat#, no sample size, no controls) as amber "add for reproducibility" hints, computed' +
      ' from the already-structured fields (NO new LLM call, no invented data). POLISH: fix the truncated' +
      ' placeholder comment in _components/Capture.tsx (make the placeholder a clean short hint; the full' +
      ' example already loads via "Try an example"). Keep the grounded/auto-inferred badges.',
  },
  {
    key: 'trial-matcher',
    body:
      'TRIAL MATCHER (research coordinator). Own: app/console/trial-matcher/** , lib/trialMatcher/** ,' +
      ' app/api/trial-matcher/**. DEEPEN: for each candidate trial add a one-line "why this rank" summary' +
      ' (e.g. "3/4 inclusion met, 0 exclusions triggered, 1 unknown") computed deterministically from the' +
      ' per-criterion assessment already produced — make the eligibility reasoning scannable at a glance' +
      ' above the detailed breakdown. POLISH: ensure _components/api.ts FetchResult carries the HTTP' +
      ' `status` so a 503/capped degraded state is distinguished from a hard 500 (the verify pass flagged' +
      ' this). Keep the honest "unknown — add the fact and re-run" behavior.',
  },
  {
    key: 'verify',
    body:
      'CLAIM VERIFICATION (medical-affairs reviewer). Own: app/console/verify/** ONLY. Use EXISTING routes' +
      ' (/api/verify/text ; /api/moa/verify-claim for the deeper "mixture" option) — do NOT edit verify' +
      ' engine libs. DEEPEN: add a copyable, citation-style provenance block for a verdict (claim, verdict,' +
      ' trust score, the flagged claim-vs-source quote pairs, and the source) that a reviewer can paste' +
      ' into a memo — a "Copy citation" / "Copy summary" action. Optionally surface a subtle toggle to run' +
      ' the deep mixture (/api/moa/verify-claim) for a claim, clearly labelled, without breaking the fast' +
      ' single-source path. Keep the flagged claim-vs-source span highlighting.',
  },
]

const DEEP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['tool', 'changed'],
  properties: { tool: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' } },
}

phase('Deepen')
const deepened = (await parallel(
  TOOLS.map((t) => () =>
    agent(
      ['Deepen the PaperTrail tool "' + t.key + '" (additive, no regression).', '', CREED, '', 'YOUR TOOL:', t.body,
        '', 'READ the tool\'s current files first (they are already demo-ready). Implement complete typed code,',
        'touch ONLY your tool\'s files, do NOT run npm/tsc/git. Return the files you changed.'].join('\n'),
      { label: 'deepen:' + t.key, phase: 'Deepen', schema: DEEP_SCHEMA }
    )
  )
)).filter(Boolean)

phase('Landing')
const landing = await agent(
  [
    'Build a REVIEWER WALKTHROUGH landing for the PaperTrail Builder Track submission at a NEW page',
    'app/console/demo/page.tsx (create the dir). It introduces the 3 named users and their tools so a',
    'judge understands the submission in 30 seconds and can launch each in one click:',
    '  - "Built Beyond the Bench" header + one-line thesis (grounded evidence tools for translational labs).',
    '  - Three cards: (1) Wet-lab scientist -> Lab Notebook (/console/lab-notebook), (2) Research coordinator',
    '    -> Trial Matcher (/console/trial-matcher), (3) Medical-affairs reviewer -> Claim Verification',
    '    (/console/verify). Each card: who they are, the job it does, why it matters, and a "Open tool ->"',
    '    link. Note each tool has a one-click "Try an example" inside.',
    '  - A short honest "what makes this different" line (deterministic effect-size recompute + verbatim-',
    '    grounded provenance; nothing invented).',
    'Client component, Tailwind matching the console look, self-contained (no new API). Do NOT edit',
    'app/console/layout.tsx (the nav link is added separately). TS strict, no any, no TODOs.',
  ].join('\n'),
  { label: 'build:demo-landing', phase: 'Landing', schema: {
    type: 'object', additionalProperties: false, required: ['file'],
    properties: { file: { type: 'string' }, notes: { type: 'string' } } } }
)

phase('Verify')
const review = await agent(
  [
    'Adversarially verify the deepened PaperTrail tools + the new /console/demo landing. For app/console/',
    '{lab-notebook,trial-matcher,verify,demo}: confirm (1) the happy path still works (no regression from',
    'the deepening); (2) the new depth (reproducibility hints / why-this-rank / copyable citation) is real',
    'and grounded, not a stub; (3) the demo landing links all 3 tools correctly; (4) no leftover placeholder/',
    'TODO text; (5) TypeScript build risks (bad imports, any, wrong shapes, missing awaits). Report concrete',
    'blocking issues with file + fix.',
  ].join('\n'),
  { label: 'verify:deepen', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false, required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'polish'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } } } }
)

log('Builder-track deepen: ' + deepened.length + ' tools + landing (' + (landing.file || '?') + '); ' + (review.issues ? review.issues.length : 0) + ' issues.')
return { deepened, landing, review }
