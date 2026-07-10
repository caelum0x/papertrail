export const meta = {
  name: 'papertrail-mcp-connector',
  description: 'Build a full PaperTrail MCP server + Claude Science skills exposing every endpoint as tools',
  phases: [
    { title: 'Scaffold', detail: 'MCP package, client, registry, server, connector docs' },
    { title: 'Tools', detail: 'tool groups + skills + v1 gateway, in parallel' },
    { title: 'Verify', detail: 'review the generated MCP surface' },
  ],
}

// Shared CONTRACT every agent codes against. No backticks inside (single quotes for code refs).
const CONTRACT = [
  'PAPERTRAIL MCP — SHARED CONTRACT (follow exactly; the scaffold agent implements it, tool agents code against it).',
  '',
  'GOAL: a standalone MCP server under mcp/ that exposes PaperTrail live endpoints as MCP tools so it can be',
  'added to Anthropic Claude Science as a Connector. It calls the DEPLOYED API over HTTP; it does NOT import',
  'any app code. Live base URL default: https://papertrail-topaz-phi.vercel.app',
  '',
  'PACKAGE: mcp/ is its own npm package, ESM ("type":"module"), TypeScript compiled to mcp/dist. Deps:',
  '"@modelcontextprotocol/sdk" ^1.12.0 and "zod" ^3.23. tsconfig: target ES2022, module NodeNext,',
  'moduleResolution NodeNext, outDir dist, strict, skipLibCheck. bin: { "papertrail-mcp": "dist/server.js" }.',
  'Scripts: build = tsc, start = node dist/server.js.',
  '',
  'CLIENT — mcp/src/client.ts exports:',
  '  export interface PaperTrailClientOptions { baseUrl?: string; apiKey?: string; timeoutMs?: number }',
  '  export class PaperTrailClient {',
  '    constructor(opts?: PaperTrailClientOptions)',
  '    post<T = unknown>(path: string, body: unknown, opts?: { auth?: boolean }): Promise<T>',
  '    get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>, opts?: { auth?: boolean }): Promise<T>',
  '  }',
  '  baseUrl resolves opts.baseUrl -> process.env.PAPERTRAIL_BASE_URL -> the live default. apiKey resolves',
  '  opts.apiKey -> process.env.PAPERTRAIL_API_KEY. It unwraps the { success, data, error } envelope: on',
  '  non-2xx or success=false it throws Error(error or status text); otherwise returns data (typed as T).',
  '  When opts.auth is true it sends header Authorization: Bearer <apiKey> and throws a clear error if no key',
  '  is set. Uses AbortController with timeoutMs default 120000. Sends content-type application/json.',
  '',
  'REGISTRY — mcp/src/registry.ts exports:',
  '  import { z } from "zod";',
  '  export interface PaperTrailTool {',
  '    name: string;              // snake_case id, e.g. verify_claim',
  '    title: string;             // human title',
  '    description: string;       // rich, scientist-facing: WHAT it does + WHEN to use it',
  '    inputSchema: z.ZodRawShape; // object of zod fields for registerTool',
  '    annotations?: { readOnlyHint?: boolean; openWorldHint?: boolean };',
  '    handler: (args: Record<string, unknown>, client: PaperTrailClient) => Promise<string>;',
  '  }',
  '  export function tool(def: PaperTrailTool): PaperTrailTool { return def }',
  '  Each handler validates args with a zod object built from inputSchema, calls the client, and returns a',
  '  human-readable STRING (a formatted summary followed by JSON.stringify(result, null, 2)). It must not throw',
  '  raw — on a client error it returns a concise error string (the server wraps it as isError).',
  '',
  'TOOL FILES export a named array of PaperTrailTool. server.ts imports all arrays and registers each via',
  'server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema,',
  'annotations: t.annotations }, async (args) => { try { return { content: [{ type: "text", text: await',
  't.handler(args, client) }] } } catch (e) { return { content: [{ type: "text", text: String(e) }], isError:',
  'true } } }). Server uses McpServer from "@modelcontextprotocol/sdk/server/mcp.js" and StdioServerTransport',
  'from "@modelcontextprotocol/sdk/server/stdio.js"; name "papertrail", version "1.0.0". server.ts is created',
  'by the scaffold agent and imports these arrays: verificationTools, synthesisTools, biomedicalTools,',
  'researchTools, orgScopedTools from ./tools/verification.js, ./tools/synthesis.js, ./tools/biomedical.js,',
  './tools/research.js, ./tools/orgScoped.js (NodeNext requires the .js extension in import paths).',
  '',
  'ENDPOINT CONTRACT: every listed endpoint is POST unless noted; body is JSON; response is the { success,',
  'data, error } envelope (client returns data). READ the route.ts file for each endpoint to get the EXACT',
  'request-body field names/zod before writing the tool input — do not guess field names.',
  '',
  'QUALITY: explicit types, no any, files < 400 lines (split a group across files if needed), rich tool',
  'descriptions a scientist would understand, no console.log except server startup on stderr.',
].join('\n')

const TOOL_NAMES = [
  'CANONICAL TOOL NAMES (use these EXACT names so skills + server agree):',
  'verification.ts -> verificationTools: verify_claim (POST /api/verify {claim, citation?}),',
  '  verify_claim_batch (/api/verify/batch), verify_text_claims (/api/verify/text),',
  '  meta_crosscheck (/api/meta-crosscheck), scientific_claim_eval (/api/scieval),',
  '  fact_check_pipeline (/api/factcheck), fact_check_document (/api/fact-check),',
  '  classify_citation (/api/citations/classify), audit_guideline (/api/guideline-audit),',
  '  draft_with_evidence (/api/drafting).',
  'synthesis.ts -> synthesisTools: meta_analysis (/api/synthesis),',
  '  continuous_meta_analysis (/api/continuous-meta), network_meta_analysis (/api/network-meta),',
  '  meta_regression (/api/meta-regression), subgroup_analysis (/api/subgroup),',
  '  survival_analysis (/api/survival), dose_response_analysis (/api/dose-response),',
  '  trial_sequential_analysis (/api/trial-sequential), risk_of_bias (/api/risk-of-bias),',
  '  evidence_report (/api/evidence-report), evidence_pipeline (/api/evidence-pipeline),',
  '  effect_size_stats (/api/stats).',
  'biomedical.ts -> biomedicalTools: bio_verify_claim (/api/bio/verify-claim),',
  '  bio_safety_signal (/api/bio/safety-signal), bio_genetic_association (/api/bio/genetic-association),',
  '  bio_target_disease (/api/bio/target-disease), bio_bioactivity (/api/bio/bioactivity),',
  '  bio_variant_pathogenicity (/api/bio/variant-pathogenicity), bio_pharmacogenomics (/api/bio/pharmacogenomics),',
  '  bio_annotate_entities (/api/bio/annotate), bio_drug_interaction (/api/bio/drug-interaction),',
  '  bio_repurposing (/api/bio/repurposing), bio_biomarker (/api/bio/biomarker).',
  'research.ts -> researchTools: paper_qa (/api/paper-qa), deep_research (/api/deep-research),',
  '  research_brief (/api/research), research_gaps_hypotheses (/api/hypotheses),',
  '  extract_paper (/api/extraction/paper), assemble_mechanism (/api/mechanism),',
  '  synthesis_report (/api/synthesis-report), knowledge_graph (/api/graph),',
  '  kg_link_predict (/api/kg/predict), extract_entities (/api/entities),',
  '  hybrid_retrieval (/api/retrieval/hybrid), evidence_dossier (/api/dossier),',
  '  real_world_evidence (/api/rwe).',
  'orgScoped.ts -> orgScopedTools (auth:true, Bearer PAPERTRAIL_API_KEY, hit the NEW v1 routes):',
  '  structure_experiment (POST /api/v1/lab-notebook {notes}),',
  '  match_patient_to_trials (POST /api/v1/trial-matcher {notes}).',
].join('\n')

phase('Scaffold')
const scaffold = await agent(
  [
    'Create the PaperTrail MCP server SCAFFOLD (the shared plumbing every tool file depends on).',
    '',
    CONTRACT,
    '',
    CONTRACT ? '' : '',
    'READ first: package.json (root) for style, lib/api/response.ts (the envelope shape you must unwrap).',
    '',
    'CREATE EXACTLY:',
    '- mcp/package.json (name "papertrail-mcp", type module, bin, scripts build/start, deps',
    '  @modelcontextprotocol/sdk ^1.12.0 + zod ^3.23, devDeps typescript ^5 + @types/node ^22).',
    '- mcp/tsconfig.json (ES2022 / NodeNext / outDir dist / strict / skipLibCheck / rootDir src).',
    '- mcp/src/client.ts — PaperTrailClient exactly per the contract (envelope unwrap, timeout, optional Bearer).',
    '- mcp/src/registry.ts — PaperTrailTool interface + tool() helper exactly per the contract.',
    '- mcp/src/server.ts — McpServer over stdio; import verificationTools, synthesisTools, biomedicalTools,',
    '  researchTools, orgScopedTools (with .js extensions) and register every tool with the try/catch wrapper',
    '  per the contract; log a one-line startup banner to stderr; construct one shared PaperTrailClient.',
    '- mcp/README.md — what it is, the env vars (PAPERTRAIL_BASE_URL, PAPERTRAIL_API_KEY), how to build',
    '  (npm install && npm run build) and run (node dist/server.js), and the full tool catalogue.',
    '- mcp/claude-science/README.md + mcp/claude-science/connector.json — a copy-paste MCP server config for',
    '  adding PaperTrail under Claude Science -> Capabilities -> Connectors (command node, args to dist/server.js,',
    '  env PAPERTRAIL_BASE_URL), plus a .mcp.json-style example. Explain that once added, a scientist can say',
    '  "verify this efficacy claim against its registry" and the deterministic engine answers in-session.',
    '',
    TOOL_NAMES,
    '',
    'Do NOT create the tool files themselves (other agents do). Do NOT run npm. Return the files you created.',
  ].join('\n'),
  { label: 'scaffold', phase: 'Scaffold', schema: buildSchema('scaffold') }
)

phase('Tools')
const groups = [
  {
    key: 'verification',
    file: 'mcp/src/tools/verification.ts (export const verificationTools)',
    body:
      'Verification + fact-check tools. Endpoints: verify_claim, verify_claim_batch, verify_text_claims,' +
      ' meta_crosscheck, scientific_claim_eval, fact_check_pipeline, fact_check_document, classify_citation,' +
      ' audit_guideline, draft_with_evidence. READ each route.ts under app/api for exact body fields.',
  },
  {
    key: 'synthesis',
    file: 'mcp/src/tools/synthesis.ts (export const synthesisTools)',
    body:
      'Deterministic evidence-synthesis / biostatistics tools (no LLM in the numeric path). Endpoints:' +
      ' meta_analysis, continuous_meta_analysis, network_meta_analysis, meta_regression, subgroup_analysis,' +
      ' survival_analysis, dose_response_analysis, trial_sequential_analysis, risk_of_bias, evidence_report,' +
      ' evidence_pipeline, effect_size_stats. These take arrays of studies/effect sizes — READ each route.ts' +
      ' AND its zod schema in lib/schemas.ts or the route to model the study input shape precisely.',
  },
  {
    key: 'biomedical',
    file: 'mcp/src/tools/biomedical.ts (export const biomedicalTools)',
    body:
      'Biomedical evidence engines over open bio-data. Endpoints: bio_verify_claim, bio_safety_signal,' +
      ' bio_genetic_association, bio_target_disease, bio_bioactivity, bio_variant_pathogenicity,' +
      ' bio_pharmacogenomics, bio_annotate_entities, bio_drug_interaction, bio_repurposing, bio_biomarker.' +
      ' READ each app/api/bio/*/route.ts for exact body fields (drug/gene/disease/variant/text params).',
  },
  {
    key: 'research',
    file: 'mcp/src/tools/research.ts (export const researchTools)',
    body:
      'Agentic research + knowledge tools. Endpoints: paper_qa, deep_research, research_brief,' +
      ' research_gaps_hypotheses, extract_paper, assemble_mechanism, synthesis_report, knowledge_graph,' +
      ' kg_link_predict, extract_entities, hybrid_retrieval, evidence_dossier, real_world_evidence.' +
      ' READ each route.ts for exact body fields. Note some run long — set client timeout generously in the description.',
  },
]

const built = await parallel([
  ...groups.map((g) => () =>
    agent(
      [
        'Write the MCP tool file: ' + g.file + '.',
        'It depends on the ALREADY-CREATED mcp/src/client.ts and mcp/src/registry.ts — import PaperTrailClient',
        'and the tool() helper and PaperTrailTool type from there (use .js extension imports, NodeNext).',
        '',
        CONTRACT,
        '',
        g.body,
        '',
        'For EACH endpoint: read its app/api route.ts to learn the exact request-body field names and zod, then',
        'define a tool with a matching zod inputSchema, a rich scientist-facing description (what + when to use),',
        'annotations.readOnlyHint true (these are read-only analyses), and a handler that POSTs the body via',
        'client.post(path, body) and returns a short formatted summary + JSON.stringify(data, null, 2).',
        'Export the named array. Do NOT edit server.ts, client.ts, registry.ts, or any app code. Do NOT run npm.',
      ].join('\n'),
      { label: 'tools:' + g.key, phase: 'Tools', schema: buildSchema(g.key) }
    )
  ),
  // v1 gateway extension + org-scoped MCP tools (owns app/api/v1 new routes + mcp/src/tools/orgScoped.ts).
  () =>
    agent(
      [
        'Two jobs, both additive (create new files only; do not edit existing exports):',
        '',
        '1) Extend the PaperTrail v1 API gateway so the two named-user features are callable with an API key.',
        '   READ lib/apiv1/gateway.ts (withApiKey), app/api/v1/verify/route.ts (pattern), lib/labNotebook/structure.ts',
        '   (structureExperiment), and lib/trialMatcher/match.ts (runTrialMatch). CREATE:',
        '   - app/api/v1/lab-notebook/route.ts: export const POST = withApiKey(async (req, ctx) => { validate',
        '     { notes } with zod (10..20000), call structureExperiment(notes), return ok(result) }, { quotaKind:',
        '     "verification", routeLabel: "v1.lab_notebook" }). runtime nodejs. Stateless compute — do NOT persist.',
        '   - app/api/v1/trial-matcher/route.ts: same shape calling runTrialMatch(notes), returning ok({ profile,',
        '     matches, droppedUngrounded }); quotaKind "verification", routeLabel "v1.trial_matcher"; maxDuration 60.',
        '   Never log the notes text. Use ok/fail from lib/api/response.',
        '',
        '2) Write mcp/src/tools/orgScoped.ts (export const orgScopedTools), importing PaperTrailClient + tool() from',
        '   the scaffold (../client.js, ../registry.js). Two tools calling the NEW v1 routes with auth:true (Bearer',
        '   PAPERTRAIL_API_KEY): structure_experiment (POST /api/v1/lab-notebook {notes}) and',
        '   match_patient_to_trials (POST /api/v1/trial-matcher {notes}). Rich descriptions noting they need a',
        '   PaperTrail API key and that the trial matcher expects DE-IDENTIFIED notes. readOnlyHint true.',
        '',
        CONTRACT,
        '',
        'Do NOT run npm. Return the files you created.',
      ].join('\n'),
      { label: 'tools:v1+orgScoped', phase: 'Tools', schema: buildSchema('v1') }
    ),
  // Claude Science Skills.
  () =>
    agent(
      [
        'Author Claude Science / Agent SKILLS that wrap PaperTrail so a scientist reaches the engine in plain',
        'language. Each skill is a folder skills/<name>/SKILL.md with YAML frontmatter (name: kebab-case matching',
        'the folder; description: one line stating WHAT it does and WHEN to use it — this is what the model matches',
        'on) and a markdown body with step-by-step instructions.',
        '',
        'Each skill body must: (a) name the exact MCP tool to call (from the canonical list below) and its inputs,',
        'and (b) give a curl fallback against the live API for when the MCP connector is not installed. Emphasize',
        'PaperTrail hard guarantees: deterministic recompute, exact-span grounding, honest no_support_found.',
        '',
        TOOL_NAMES,
        '',
        'CREATE these skills (folder + SKILL.md each):',
        '- skills/papertrail-verify-claim — verify an efficacy/magnitude claim against its primary source (verify_claim).',
        '- skills/papertrail-evidence-synthesis — pool studies into a meta-analysis with GRADE (meta_analysis, evidence_report).',
        '- skills/papertrail-trial-matcher — match de-identified patient notes to eligible trials (match_patient_to_trials).',
        '- skills/papertrail-lab-notebook — structure rough bench notes into a reproducible record (structure_experiment).',
        '- skills/papertrail-safety-signal — pharmacovigilance PRR/ROR from FAERS (bio_safety_signal).',
        '- skills/papertrail-target-disease — target-disease evidence + genetic association (bio_target_disease, bio_genetic_association).',
        '- skills/papertrail-research-brief — grounded deep-research brief with citations (deep_research, paper_qa).',
        '- skills/papertrail-research-gaps — grounded research gaps + testable hypotheses (research_gaps_hypotheses).',
        '- skills/README.md — index of the skills + how to install them in Claude Science (Capabilities -> Skills).',
        '',
        'Do NOT write code files or touch mcp/. Return the skill folders you created.',
      ].join('\n'),
      { label: 'skills', phase: 'Tools', schema: buildSchema('skills') }
    ),
]).then((r) => r.filter(Boolean))

phase('Verify')
const review = await agent(
  [
    'Review the generated PaperTrail MCP surface for correctness and consistency. READ mcp/src/server.ts,',
    'mcp/src/client.ts, mcp/src/registry.ts, and every file under mcp/src/tools/. Check:',
    '- server.ts imports and registers all five tool arrays; tool names are unique and match the canonical list.',
    '- Every tool file imports from ../client.js and ../registry.js with correct .js NodeNext extensions.',
    '- Handlers call client.post/get with plausible paths and return strings (never throw raw).',
    '- inputSchema field names look consistent with the corresponding app/api route.ts bodies (spot-check 5).',
    '- orgScoped tools pass auth:true; the two new app/api/v1 routes use withApiKey correctly.',
    '- No obvious TypeScript errors (bad imports, missing exports, wrong types).',
    'Report concrete issues with file + fix. Do not rewrite code.',
  ].join('\n'),
  { label: 'verify:mcp', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues', 'toolCount'],
    properties: {
      toolCount: { type: 'number' },
      issues: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['severity', 'file', 'problem', 'fix'],
        properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } },
    },
  } }
)

log('MCP build complete. scaffold + ' + built.length + ' tool/skill groups. ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { scaffold, built, review }

// --- helper: a permissive build-result schema per agent ---
function buildSchema(key) {
  return {
    type: 'object', additionalProperties: false,
    required: ['group', 'filesCreated'],
    properties: {
      group: { type: 'string' },
      filesCreated: { type: 'array', items: { type: 'string' } },
      toolNames: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
    },
  }
}
