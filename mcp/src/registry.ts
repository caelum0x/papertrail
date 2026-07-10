// Tool registry contract shared by every PaperTrail MCP tool file.
//
// A PaperTrailTool is a self-describing unit: an MCP name/title/description, a
// zod input shape (validated before the network call), optional MCP hint
// annotations, and a handler that talks to the deployed API via PaperTrailClient
// and returns a human-readable string. server.ts registers each one.

import { z } from "zod";
import type { PaperTrailClient } from "./client.js";

export interface PaperTrailTool {
  // snake_case id, e.g. verify_claim. Must be unique across all tool files.
  name: string;
  // Human-facing title shown in the tool picker.
  title: string;
  // Rich, scientist-facing description: WHAT it does + WHEN to use it.
  description: string;
  // Object of zod fields, passed straight to server.registerTool's inputSchema.
  inputSchema: z.ZodRawShape;
  // MCP behavioural hints. readOnlyHint: no side effects. openWorldHint: reaches
  // external systems (PaperTrail hits live registries, so usually true).
  annotations?: {
    readOnlyHint?: boolean;
    openWorldHint?: boolean;
  };
  // Validates args, calls the client, returns a formatted human-readable string.
  // Must NOT throw raw — on a client error, return a concise error string; the
  // server wraps thrown errors as isError, but tools should prefer friendly text.
  handler: (
    args: Record<string, unknown>,
    client: PaperTrailClient
  ) => Promise<string>;
}

// Identity helper that gives each tool definition its full type without
// repeating the annotation. Use `tool({ ... })` in every tool file.
export function tool(def: PaperTrailTool): PaperTrailTool {
  return def;
}

// Shared formatting helper for handlers: a short summary line/section followed
// by the full JSON payload. Tool files import this so output is consistent.
export function formatResult(summary: string, result: unknown): string {
  const body = JSON.stringify(result, null, 2);
  return `${summary}\n\n${body}`;
}

// Shared helper to turn an unknown thrown value into a concise, user-safe
// message. Handlers use this to satisfy the "never throw raw" rule.
export function toErrorMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    const path = first?.path.join(".");
    return `Invalid input${path ? ` for "${path}"` : ""}: ${
      first?.message ?? "validation failed"
    }`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
