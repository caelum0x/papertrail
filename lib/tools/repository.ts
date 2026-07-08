import type { Pool } from "pg";
import type {
  ToolCall,
  ToolCallStatus,
  ToolRegistration,
} from "./types";

// Data access for the MCP tool registry. Every query is org-scoped (org_id in the
// WHERE clause) so one org can never read or mutate another's registrations or call
// history. Rows are normalized to the API-facing camelCase shapes here.

function toRegistration(row: {
  id: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown> | null;
  enabled: boolean;
  created_at: Date | string;
}): ToolRegistration {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    inputSchema: row.input_schema ?? {},
    enabled: row.enabled,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toToolCall(row: {
  id: string;
  tool_name: string;
  input: Record<string, unknown> | null;
  output: unknown;
  status: string;
  duration_ms: number;
  created_at: Date | string;
}): ToolCall {
  return {
    id: row.id,
    toolName: row.tool_name,
    input: row.input ?? {},
    output: row.output ?? null,
    status: (row.status as ToolCallStatus) ?? "success",
    durationMs: row.duration_ms ?? 0,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** All of an org's registered (custom) tools, newest-first. */
export async function listRegistrations(
  pool: Pool,
  orgId: string
): Promise<ToolRegistration[]> {
  const { rows } = await pool.query(
    `select id, name, description, input_schema, enabled, created_at
       from tool_registrations
      where org_id = $1
      order by created_at desc`,
    [orgId]
  );
  return rows.map(toRegistration);
}

/** Count an org's tool calls (for paginated history). */
export async function countToolCalls(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as total from tool_calls where org_id = $1`,
    [orgId]
  );
  return rows[0]?.total ?? 0;
}

/** An org's tool-call history, newest-first, paginated. */
export async function listToolCalls(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<ToolCall[]> {
  const { rows } = await pool.query(
    `select id, tool_name, input, output, status, duration_ms, created_at
       from tool_calls
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toToolCall);
}

/** Record a single tool invocation. Best-effort persistence lives at the call site. */
export async function insertToolCall(
  pool: Pool,
  entry: {
    orgId: string;
    toolName: string;
    input: Record<string, unknown>;
    output: unknown;
    status: ToolCallStatus;
    durationMs: number;
  }
): Promise<ToolCall> {
  const { rows } = await pool.query(
    `insert into tool_calls (org_id, tool_name, input, output, status, duration_ms)
     values ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
     returning id, tool_name, input, output, status, duration_ms, created_at`,
    [
      entry.orgId,
      entry.toolName,
      JSON.stringify(entry.input ?? {}),
      entry.output === undefined ? null : JSON.stringify(entry.output),
      entry.status,
      entry.durationMs,
    ]
  );
  return toToolCall(rows[0]);
}
