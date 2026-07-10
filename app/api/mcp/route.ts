// Remote (hosted) MCP server for PaperTrail — Streamable-HTTP transport in
// single-JSON-response mode. Add it to Anthropic Claude Science via
// Connectors -> Add connector -> Remote URL, pasting this endpoint's URL.
//
// This is a stateless JSON-RPC 2.0 server: it exposes the SAME public tools as
// the local stdio MCP package (see lib/mcp/catalog.ts) but over HTTP, dispatching
// each tool call to our own public /api routes (lib/mcp/dispatch.ts). No sessions,
// no server-initiated SSE stream — every request gets a single JSON response.
//
// It is intentionally public/unauthenticated: only read-only, key-free tools are
// exposed (the two orgScoped API-key tools are omitted from the catalog). Request
// bodies are never logged; only method names are.

import { MCP_TOOLS, type McpToolDef } from "@/lib/mcp/catalog";
import { dispatchTool } from "@/lib/mcp/dispatch";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "papertrail", version: "1.0.0" } as const;

// Permissive CORS so the connector (any origin) can reach this endpoint.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version",
};

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  ...CORS_HEADERS,
};

// JSON-RPC 2.0 error codes we emit.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

// A JSON-RPC id is a string, number, or null (notifications omit it entirely).
type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  readonly jsonrpc: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

interface JsonRpcErrorResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: { readonly code: number; readonly message: string };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function successResponse(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A message with no "id" property is a notification: it gets no response.
function isNotification(msg: JsonRpcRequest): boolean {
  return !("id" in msg) || msg.id === undefined;
}

// Validate the JSON-RPC framing of a single message. Returns the id (or null)
// when the frame is well-formed enough to answer.
function normalizeId(rawId: unknown): JsonRpcId {
  if (typeof rawId === "string" || typeof rawId === "number" || rawId === null) {
    return rawId;
  }
  return null;
}

const TOOL_LIST = MCP_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

const TOOL_BY_NAME: ReadonlyMap<string, McpToolDef> = new Map(
  MCP_TOOLS.map((t) => [t.name, t] as const)
);

// Shape a successful tool payload as an MCP tool result (text content block).
function toolResult(payload: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

// Shape a tool failure as an MCP tool result with isError:true (NOT a JSON-RPC
// error — per MCP, tool failures are results the model can read and recover from).
function toolError(message: string): unknown {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Run a single tools/call and return its result object. Never throws.
async function handleToolCall(params: unknown, origin: string): Promise<unknown> {
  if (!isRecord(params) || typeof params.name !== "string") {
    return toolError("Invalid tools/call params: a string `name` is required.");
  }
  const tool = TOOL_BY_NAME.get(params.name);
  if (!tool) {
    return toolError(`Unknown tool: ${params.name}`);
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  try {
    const payload = await dispatchTool(tool, args, origin);
    return toolResult(payload);
  } catch (err: unknown) {
    return toolError(getErrorMessage(err));
  }
}

// Handle one well-framed JSON-RPC request message. Returns a response, or null
// for a notification (which must not produce a response).
async function handleMessage(
  msg: JsonRpcRequest,
  origin: string
): Promise<JsonRpcResponse | null> {
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    // Notifications with bad framing still get no response.
    if (isNotification(msg)) {
      return null;
    }
    return errorResponse(normalizeId(msg.id), INVALID_REQUEST, "Invalid JSON-RPC request.");
  }

  const notification = isNotification(msg);
  const id = notification ? null : normalizeId(msg.id);
  const { method } = msg;

  // Notifications (e.g. notifications/initialized) never get a response.
  if (notification) {
    return null;
  }

  switch (method) {
    case "initialize":
      return successResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "tools/list":
      return successResponse(id, { tools: TOOL_LIST });
    case "tools/call": {
      const result = await handleToolCall(msg.params, origin);
      return successResponse(id, result);
    }
    case "ping":
      return successResponse(id, {});
    default:
      return errorResponse(id, METHOD_NOT_FOUND, "Method not found");
  }
}

// POST is the only MCP method: accept a single request object OR a batch array.
export async function POST(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;

  let parsed: unknown;
  try {
    const text = await req.text();
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    return jsonResponse(errorResponse(null, PARSE_ERROR, "Parse error"), 200);
  }

  if (parsed === undefined) {
    return jsonResponse(errorResponse(null, INVALID_REQUEST, "Empty request body."), 200);
  }

  // Batch: an array of messages. Per JSON-RPC, notification-only batches produce
  // no response body (HTTP 202); otherwise return the array of responses.
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return jsonResponse(errorResponse(null, INVALID_REQUEST, "Invalid Request"), 200);
    }
    const responses: JsonRpcResponse[] = [];
    for (const item of parsed) {
      const msg = isRecord(item) ? (item as unknown as JsonRpcRequest) : null;
      if (!msg) {
        responses.push(errorResponse(null, INVALID_REQUEST, "Invalid Request"));
        continue;
      }
      const res = await handleMessage(msg, origin);
      if (res !== null) {
        responses.push(res);
      }
    }
    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    }
    return jsonResponse(responses, 200);
  }

  if (!isRecord(parsed)) {
    return jsonResponse(errorResponse(null, INVALID_REQUEST, "Invalid Request"), 200);
  }

  const msg = parsed as unknown as JsonRpcRequest;

  // A lone notification gets HTTP 202 with an empty body and no JSON-RPC response.
  if (msg.jsonrpc === "2.0" && typeof msg.method === "string" && isNotification(msg)) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  try {
    const res = await handleMessage(msg, origin);
    if (res === null) {
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    }
    return jsonResponse(res, 200);
  } catch (err: unknown) {
    // A method handler should never throw, but guard the transport regardless.
    return jsonResponse(
      errorResponse(normalizeId(msg.id), INTERNAL_ERROR, getErrorMessage(err)),
      200
    );
  }
}

// CORS preflight.
export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// This endpoint is POST-only MCP; there is no server-initiated SSE stream.
export function GET(): Response {
  return jsonResponse(
    {
      error: "Method Not Allowed",
      message:
        "This is a POST-only MCP (Streamable-HTTP, single-JSON-response) endpoint. Add it to Claude via Connectors -> Add connector -> Remote URL. No SSE stream is served.",
    },
    405
  );
}

// Serialize a JSON body with the standard headers.
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
