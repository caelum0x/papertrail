// Tool dispatch for the hosted PaperTrail MCP server.
//
// Given a resolved McpToolDef, a caller's arguments, and our own origin, this
// calls the corresponding public PaperTrail /api route over HTTP and unwraps the
// standard { success, data, error } envelope, returning a plain JSON-serialisable
// payload. It never throws for a tool-level failure — the route.ts layer turns a
// thrown error into an MCP tool result with isError:true (tool failures are
// results, not JSON-RPC errors). Request bodies are never logged here.

import type { McpToolDef } from "./catalog.js";

// The unwrapped payload handed back to the MCP client (opaque JSON).
export type DispatchPayload = unknown;

// A minimal view of the { success, data, error } envelope every /api route
// returns. Anything that lacks a boolean `success` is treated as a raw payload.
interface ApiEnvelope {
  readonly success?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// True when the parsed body looks like PaperTrail's response envelope.
function isEnvelope(value: unknown): value is ApiEnvelope {
  return isRecord(value) && typeof value.success === "boolean";
}

// Split a caller's arguments into a JSON body and query params according to the
// tool's `queryKeys`. Keys listed in queryKeys are lifted to the query string
// (only if present and not undefined); everything else stays in the body. Never
// mutates the input object.
function partitionArgs(
  args: Record<string, unknown>,
  queryKeys: readonly string[]
): { readonly body: Record<string, unknown>; readonly query: Record<string, string> } {
  if (queryKeys.length === 0) {
    return { body: { ...args }, query: {} };
  }
  const querySet = new Set(queryKeys);
  const body: Record<string, unknown> = {};
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) {
      continue;
    }
    if (querySet.has(key)) {
      query[key] = String(value);
    } else {
      body[key] = value;
    }
  }
  return { body, query };
}

// Build the absolute URL to our own /api route, appending any query params.
function buildUrl(origin: string, path: string, query: Record<string, string>): string {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

// Call the tool's underlying /api route on our own origin and return the
// unwrapped payload. Throws a plain Error (with a user-safe message) on any
// transport or non-OK response; route.ts converts that into an isError result.
export async function dispatchTool(
  tool: McpToolDef,
  args: Record<string, unknown>,
  origin: string,
  signal?: AbortSignal
): Promise<DispatchPayload> {
  const { body, query } = partitionArgs(args, tool.queryKeys ?? []);
  const url = buildUrl(origin, tool.path, query);

  const init: RequestInit = {
    method: tool.method,
    headers: { "content-type": "application/json", accept: "application/json" },
    ...(signal ? { signal } : {}),
  };
  if (tool.method === "POST") {
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach ${tool.path}: ${detail}`);
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const message =
      isEnvelope(parsed) && typeof parsed.error === "string"
        ? parsed.error
        : `${tool.path} responded ${res.status} ${res.statusText}.`;
    throw new Error(message);
  }

  if (isEnvelope(parsed)) {
    if (parsed.success === false) {
      const message = typeof parsed.error === "string" ? parsed.error : `${tool.path} reported failure.`;
      throw new Error(message);
    }
    return parsed.data;
  }

  // No recognizable envelope: hand back whatever the route returned.
  return parsed;
}
