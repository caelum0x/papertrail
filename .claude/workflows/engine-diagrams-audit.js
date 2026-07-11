export const meta = {
  name: 'engine-diagrams-audit',
  description: 'Per-engine data-flow diagrams (Mermaid) + audit of which step actually calls the Claude API vs deterministic',
  phases: [
    { title: 'Analyze', detail: 'read each engine + its native lib + route; diagram + Claude audit' },
  ],
}

const FRAME = [
  'PAPERTRAIL has 17 vendored OSS engines under backend/engines/, each with a PaperTrail-native papertrail_*.py',
  'specialization + a PAPERTRAIL.md, mirrored by a native TypeScript module in lib/ and exposed by an app/api route.',
  'The moat is: NO LLM in any numeric/verdict/scoring path (deterministic), Claude ONLY for language steps',
  '(extraction / judgment / tagging / prose) that are then GROUNDED (verbatim span or dropped).',
  '',
  'For EACH engine in your cluster, READ its backend/engines/<engine>/papertrail_*.py + PAPERTRAIL.md, its native',
  'lib/ module, and its app/api route. Then produce, per engine:',
  '  - a Mermaid flowchart of how the engine is used in the product: input -> [engine steps, each marked',
  '    (Claude) or (deterministic)] -> native lib module -> API route -> the product feature it powers. Show where',
  '    grounding (locateSpan) gates the output. Keep node labels short; valid Mermaid.',
  '  - claudeStep: the exact step (if any) that calls the Claude API at runtime (name the function + file), or',
  '    "none — fully deterministic" if the engine has no LLM step.',
  '  - claudeWired: true only if that Claude step is ACTUALLY invoked by default at runtime (a real',
  '    callClaudeForJson / callClaude default), false if it is stubbed / injectable-only-with-no-default / never',
  '    reached. Be precise — READ the code; do not assume.',
  '  - route + feature: the app/api path and the product capability it serves.',
  '',
  'This is READ-ONLY analysis — do NOT edit any file. Be accurate and grounded in the code you read.',
].join('\n')

const CLUSTERS = [
  { key: 'verification', engines: 'MiniCheck, multivers, Valsci, OpenFactVerification' },
  { key: 'retrieval-research', engines: 'paper-qa, R2R, storm, open_deep_research' },
  { key: 'bio-kg-nlp', engines: 'indra, scispacy, pykeen, biocypher' },
  { key: 'sources-screening-meta', engines: 'pyalex, pytrials, asreview, PyMARE, faers, clinvar, chembl' },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['cluster', 'engines'],
  properties: {
    cluster: { type: 'string' },
    engines: {
      type: 'array',
      items: { type: 'object', additionalProperties: false,
        required: ['name', 'mermaid', 'claudeStep', 'claudeWired', 'route', 'feature'],
        properties: {
          name: { type: 'string' },
          mermaid: { type: 'string', description: 'valid Mermaid flowchart source' },
          claudeStep: { type: 'string' },
          claudeWired: { type: 'boolean' },
          route: { type: 'string' },
          feature: { type: 'string' },
          deterministicSteps: { type: 'string' },
        } },
    },
  },
}

phase('Analyze')
const results = (await parallel(
  CLUSTERS.map((c) => () =>
    agent(
      [
        'Diagram + Claude-usage audit for the PaperTrail engine cluster: ' + c.key + '. Engines: ' + c.engines + '.',
        '',
        FRAME,
        '',
        'Return one entry per engine with a valid Mermaid flowchart, the precise Claude step (+ whether it is',
        'actually wired to run by default), the route, and the feature. Ground every claim in the code you read.',
      ].join('\n'),
      { label: 'audit:' + c.key, phase: 'Analyze', agentType: 'Explore', schema: SCHEMA }
    )
  )
)).filter(Boolean)

log('Engine diagrams + Claude audit complete for ' + results.length + ' clusters.')
return { results }
