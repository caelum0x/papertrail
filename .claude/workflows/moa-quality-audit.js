export const meta = {
  name: 'moa-quality-audit',
  description: 'Read-only audit: one agent per MoA agent, find where the composition can output a WRONG verdict vs Claude + robustness gaps',
  phases: [
    { title: 'Audit', detail: 'one auditor per MoA agent + the core mix' },
    { title: 'Rank', detail: 'synthesize a single prioritized fix-list' },
  ],
}

const GOAL = [
  'PAPERTRAIL is a Mixture-of-Agents (MoA) clinical-evidence verifier. The MISSION now: make it',
  'demonstrably BEAT Claude-alone on accuracy while keeping the deterministic moat. The verdict +',
  'trust come from a DETERMINISTIC aggregator (lib/moa/aggregate.ts) mixing each agent VOTE',
  '(signal in supports|refutes|mixed|insufficient|neutral, with a confidence and a gate weight).',
  'Claude only runs inside agents grounded language steps, the routing planner, and the narrative.',
  '',
  'Agents COMPOSE via a typed blackboard: enrichers PRODUCE artifacts (entities, effect_sizes,',
  'quality, relevance, design_priors, mechanisms), verifiers CONSUME them and VOTE. Key edges:',
  'minicheck+discrepancy audit sources; quant-extractor->pymare pools; paperqa->quality weights;',
  'loki->relevance; valsci->contested->storm.',
  '',
  'YOUR JOB (READ-ONLY, do NOT edit): audit ONE agent for anything that makes the MoA output a',
  'WRONG or WEAK verdict versus simply asking Claude. Look specifically for:',
  '  1. WRONG-VERDICT risks: could this agent vote supports on a distorted claim, refutes on an',
  '     accurate one, or force insufficient/NEI when the evidence is decisive? (These directly lose',
  '     to Claude-alone.) Name the exact input that would trigger it.',
  '  2. Signal/confidence miscalibration: is the confidence too low (so a correct vote gets drowned',
  '     in the mix) or too high (so a weak vote dominates)? Is the gate too low (agent skipped when',
  '     it should fire) or too high?',
  '  3. Composition gaps: does it declare consumes[] it never reads, or read the blackboard without',
  '     declaring it? Does it recompute something an upstream artifact already provides?',
  '  4. Robustness: unhandled edge cases, ungrounded spans, throws that should be skips, LLM-JSON',
  '     fragility, off-by-one, empty-input handling.',
  '  5. Missed capability: a distortion class it should catch but does not (magnitude, population',
  '     overgeneralization, dropped caveat, wrong direction, cross-source conflict).',
  '',
  'Ground every finding in the actual code you READ. For each issue give: severity (high=changes a',
  'verdict, medium=miscalibration/robustness, low=polish), the file+line, the concrete failing',
  'input, and the specific fix. Be precise and adversarial; do NOT rubber-stamp.',
].join('\n')

// One auditor per agent file (+ the deterministic core as its own audit).
const TARGETS = [
  { id: 'discrepancy', file: 'lib/moa/agents/discrepancy.ts (+ lib/verify/discrepancy.ts)' },
  { id: 'minicheck', file: 'lib/moa/agents/minicheck.ts' },
  { id: 'magnitude', file: 'lib/moa/agents/magnitude.ts' },
  { id: 'pymare', file: 'lib/moa/agents/pymare.ts' },
  { id: 'multivers', file: 'lib/moa/agents/multivers.ts' },
  { id: 'valsci', file: 'lib/moa/agents/valsci.ts' },
  { id: 'storm', file: 'lib/moa/agents/storm.ts' },
  { id: 'quant-extractor', file: 'lib/moa/agents/quant-extractor.ts' },
  { id: 'paperqa', file: 'lib/moa/agents/paperqa.ts' },
  { id: 'loki', file: 'lib/moa/agents/loki.ts' },
  { id: 'iterative', file: 'lib/moa/agents/iterative.ts' },
  { id: 'r2r', file: 'lib/moa/agents/r2r.ts' },
  { id: 'scispacy', file: 'lib/moa/agents/scispacy.ts' },
  { id: 'indra', file: 'lib/moa/agents/indra.ts' },
  { id: 'pytrials', file: 'lib/moa/agents/pytrials.ts' },
  { id: 'autoreview', file: 'lib/moa/agents/autoreview.ts' },
  { id: 'autogather', file: 'lib/moa/agents/autogather.ts' },
  { id: 'autoloop', file: 'lib/moa/agents/autoloop.ts' },
  { id: 'asreview', file: 'lib/moa/agents/asreview.ts' },
  { id: 'pyalex', file: 'lib/moa/agents/pyalex.ts' },
  { id: 'pykeen', file: 'lib/moa/agents/pykeen.ts' },
  { id: 'biocypher', file: 'lib/moa/agents/biocypher.ts' },
  { id: 'evidence-integrator', file: 'lib/moa/agents/evidence-integrator.ts' },
  { id: 'CORE-MIX', file: 'lib/moa/aggregate.ts + lib/moa/router.ts + lib/moa/scheduler.ts + lib/moa/orchestrate.ts' },
]

const ISSUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['target', 'issues'],
  properties: {
    target: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'category', 'location', 'failingInput', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          category: { type: 'string', enum: ['wrong_verdict', 'calibration', 'composition', 'robustness', 'missed_capability'] },
          location: { type: 'string' },
          failingInput: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

phase('Audit')
const audits = (await parallel(
  TARGETS.map((t) => () =>
    agent(
      [
        'Audit the PaperTrail MoA target: ' + t.id + ' (' + t.file + ').',
        '',
        GOAL,
        '',
        'READ ' + t.file + ' and any lib it calls. Also READ lib/moa/types.ts + lib/moa/aggregate.ts to',
        'understand how this agent vote is weighted. Return every concrete issue you can justify from the',
        'code, worst first. If the agent is genuinely solid, return few/zero issues — do not invent.',
      ].join('\n'),
      { label: 'audit:' + t.id, phase: 'Audit', agentType: 'Explore', schema: ISSUE_SCHEMA }
    )
  )
)).filter(Boolean)

const allIssues = audits.flatMap((a) => (a.issues || []).map((i) => ({ target: a.target, ...i })))
log('Collected ' + allIssues.length + ' issues across ' + audits.length + ' targets.')

phase('Rank')
const ranked = await agent(
  [
    'You are the quality lead for PaperTrail MoA. Below are audit findings across all agents. Produce a',
    'SINGLE prioritized fix-list to make the MoA beat Claude-alone on accuracy while keeping the',
    'deterministic moat. Dedupe overlapping issues, drop false positives, and order by expected accuracy',
    'impact (verdict-changing bugs first, then calibration, then robustness). For each, give a crisp',
    'action and which file to change. Focus on the changes most likely to move the benchmark.',
    '',
    'FINDINGS (JSON):',
    JSON.stringify(allIssues).slice(0, 60000),
  ].join('\n'),
  { label: 'rank:fixlist', phase: 'Rank', schema: {
    type: 'object', additionalProperties: false,
    required: ['fixes'],
    properties: {
      fixes: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['priority', 'file', 'action', 'rationale'],
          properties: {
            priority: { type: 'integer' },
            file: { type: 'string' },
            action: { type: 'string' },
            rationale: { type: 'string' },
            expectedImpact: { type: 'string' },
          },
        },
      },
    },
  } }
)

log('Prioritized ' + (ranked.fixes ? ranked.fixes.length : 0) + ' fixes.')
return { totalIssues: allIssues.length, allIssues, fixlist: ranked.fixes }
