import { z } from "zod";
import type { Ctx } from "@/lib/api/handler";

// Shared types for the MCP / tool registry. A "tool" is a named, schema-validated
// capability that reuses PaperTrail's existing agents/verification under the hood.
// Built-in tools are defined in code (registry.ts); org-registered tools live in
// the tool_registrations table.

export type ToolSource = "builtin" | "registered";

// A tool executor validates its input against `inputSchema`, then runs. It never
// throws for bad input — callTool() validates first and surfaces a clean error.
export interface ToolExecutor<TInput> {
  (input: TInput, ctx: Ctx): Promise<unknown>;
}

// A built-in tool: a zod input schema plus an executor that reuses existing agents.
export interface BuiltinTool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: ToolExecutor<TInput>;
}

// The JSON-serializable shape of a tool as exposed to clients (GET /api/tools) and
// the MCP manifest. `inputSchema` is a JSON-Schema-ish object derived from the zod
// schema (built-in) or stored verbatim (registered).
export interface ToolDescriptor {
  name: string;
  description: string;
  source: ToolSource;
  enabled: boolean;
  inputSchema: Record<string, unknown>;
}

// A row from tool_registrations, normalized for the API layer.
export interface ToolRegistration {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

// A row from tool_calls, normalized for the API layer.
export type ToolCallStatus = "success" | "error";

export interface ToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  status: ToolCallStatus;
  durationMs: number;
  createdAt: string;
}

// The result of executing a tool via callTool(): either an ok output or an error
// message, plus how long the executor ran. The API layer records this to tool_calls.
export interface ToolResult {
  ok: boolean;
  output: unknown;
  error: string | null;
  durationMs: number;
}
