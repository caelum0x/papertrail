export const meta = {
  name: 'papertrail-remote-mcp',
  description: 'Host a Streamable-HTTP MCP endpoint at /api/mcp so Claude Science can add PaperTrail as a Remote URL connector',
  phases: [
    { title: 'Build', detail: 'catalog + /api/mcp JSON-RPC route' },
    { title: 'Verify', detail: 'protocol + build review' },
  ],
}

const SPEC = [
  'Build a REMOTE (hosted, HTTP) MCP server as a Next.js route so Anthropic Claude Science can add PaperTrail',
  'via Connectors -> Add connector -> Remote URL by pasting https://papertrail-topaz-phi.vercel.app/api/mcp .',
  'It exposes the SAME tools the local stdio MCP already exposes, but over HTTP, calling our own public API.',
  '',
  'SOURCE OF TRUTH: the already-built local MCP tool files under mcp/src/tools/*.ts (verification.ts,',
  'synthesis.ts + synthesis.shared.ts, biomedical.ts + biomedicalCore.ts + biomedicalExtra.ts, research.ts).',
  'READ them all. Each tool there has: a snake_case name, a description, a zod inputSchema, and a handler that',
  'POSTs (or GETs with ?summarize) to a specific /api/... path. Mirror EVERY public tool (skip the two',
  'orgScoped API-key tools — the hosted endpoint is public/unauthenticated). That is ~44 tools.',
  '',
  'CREATE:',
  '1. lib/mcp/catalog.ts — export interface McpToolDef { name: string; description: string; method: "POST" |',
  '   "GET"; path: string; inputSchema: Record<string, unknown> /* JSON Schema object */; queryKeys?: string[] }',
  '   and export const MCP_TOOLS: McpToolDef[]. Translate each zod inputSchema from the mcp/src/tools files into',
  '   an equivalent JSON Schema object (type object, properties, required, enums, min/max as described). For the',
  '   three tools whose app route reads a query param (bio_target_disease, bio_repurposing, bio_biomarker use',
  '   ?summarize=true; others POST a JSON body), record queryKeys so the dispatcher moves those args to the query',
  '   string. Keep field names EXACT — they must match the app route bodies.',
  '2. app/api/mcp/route.ts — a stateless MCP server over HTTP implementing JSON-RPC 2.0 (the MCP Streamable-HTTP',
  '   transport in single-JSON-response mode). export const runtime = "nodejs"; export const maxDuration = 60.',
  '   Handle POST with a JSON-RPC request (object OR array/batch). Methods:',
  '     - "initialize" -> result { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo:',
  '       { name: "papertrail", version: "1.0.0" } }',
  '     - "tools/list" -> result { tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description,',
  '       inputSchema: t.inputSchema })) }',
  '     - "tools/call" -> params { name, arguments }. Find the tool; dispatch by calling our OWN origin',
  '       (new URL(req.url).origin) + t.path via fetch: POST with the JSON body (minus queryKeys, which go to',
  '       the query string) or GET. Parse the response; if it has a { success, data } envelope use data, else use',
  '       the raw body. Return result { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] }.',
  '       On any error return result { content: [{ type: "text", text: message }], isError: true } (NOT a',
  '       JSON-RPC error — tool failures are results per MCP).',
  '     - "ping" -> result {}',
  '     - any notification (JSON-RPC message with no "id", e.g. "notifications/initialized") -> return HTTP 202',
  '       with an empty body and DO NOT send a JSON-RPC response.',
  '     - unknown method -> JSON-RPC error { code: -32601, message: "Method not found" }.',
  '   Validate JSON-RPC framing; a parse error -> error -32700; invalid request -> -32600. Every response is',
  '   { jsonrpc: "2.0", id, result | error }. Set permissive CORS headers (Access-Control-Allow-Origin *,',
  '   Allow-Methods POST OPTIONS, Allow-Headers content-type, mcp-session-id, mcp-protocol-version) on all',
  '   responses. Add an OPTIONS handler (204 + CORS) and a GET handler returning 405 with a tiny JSON note that',
  '   this endpoint is POST-only MCP (no server-initiated SSE stream).',
  '   Never log request bodies beyond method names. Keep files < 400 lines (split a dispatcher helper into',
  '   lib/mcp/dispatch.ts if needed).',
  '',
  'CONVENTIONS: TypeScript strict, explicit exported types, no any (narrow unknown), immutable. Do NOT edit the',
  'mcp/ package or app auth. Do NOT run npm. Return the files you created.',
].join('\n')

phase('Build')
const build = await agent(SPEC, {
  label: 'build:remote-mcp',
  phase: 'Build',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['filesCreated', 'toolCount', 'notes'],
    properties: {
      filesCreated: { type: 'array', items: { type: 'string' } },
      toolCount: { type: 'number' },
      notes: { type: 'string' },
    },
  },
})

phase('Verify')
const review = await agent(
  [
    'Review the hosted MCP endpoint just built. READ app/api/mcp/route.ts, lib/mcp/catalog.ts, and any',
    'lib/mcp/dispatch.ts. Verify:',
    '- JSON-RPC framing is correct: initialize / tools/list / tools/call / ping handled; notifications (no id)',
    '  return 202 with no body; unknown method returns -32601; every response has jsonrpc "2.0" and echoes id.',
    '- tools/list returns each tool with a valid JSON-Schema inputSchema; tool names are unique and match the',
    '  mcp/src/tools/*.ts names; ~44 public tools present (orgScoped correctly excluded).',
    '- tools/call dispatches to the correct /api path with the right method, moves ?summarize-style queryKeys to',
    '  the query string, unwraps the {success,data} envelope when present, and returns tool errors as',
    '  isError results (not JSON-RPC errors).',
    '- CORS + OPTIONS present; runtime nodejs; no obvious TypeScript/build errors; no request-body logging.',
    'Spot-check 5 catalog entries against their app/api route.ts bodies for exact field names. Report concrete',
    'issues with file + fix. Do not rewrite code.',
  ].join('\n'),
  { label: 'verify:remote-mcp', phase: 'Verify', agentType: 'Explore', schema: {
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

log('Remote MCP built. ' + (build.toolCount || '?') + ' tools; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { build, review }
