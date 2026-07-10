import { z } from "zod";

// Request/response contract for Data Chat — a conversational Claude agent (tool-use)
// that answers questions about ONE ORG's own evidence library: its saved evidence
// reports, its cached primary sources, and its claims.
//
// This is the tenant-data analog of the public Research Copilot. The wire contract
// is deliberately small: the client sends a running list of user/assistant turns;
// the server runs the tool-use loop (every tool org-scoped by the server-resolved
// orgId — NEVER a client value) and returns the final assistant turn PLUS a
// transparent trace and a citation list. Citations only ever point at the org's own
// saved reports / sources / claims that a tool actually returned — never fabricated
// by the model — so `grounded` holds by construction.

// One chat turn on the wire. Only user/assistant roles cross the boundary; the
// system prompt and tool plumbing live server-side and are never client-supplied.
export const DataChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});
export type DataChatMessage = z.infer<typeof DataChatMessageSchema>;

// Public request: the conversation so far. Bounded so a caller can't smuggle an
// unbounded history (token-burn / abuse). The final turn should be from the user.
export const DataChatRequestSchema = z.object({
  messages: z.array(DataChatMessageSchema).min(1).max(40),
});
export type DataChatRequest = z.infer<typeof DataChatRequestSchema>;

// A single tool invocation the agent made, surfaced to the UI as a trace pill.
// `ok=false` carries the sanitized error the executor returned (never a stack).
export const DataChatToolTraceSchema = z.object({
  tool: z.string(),
  input: z.record(z.unknown()),
  ok: z.boolean(),
  error: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  // A compact, human-readable one-liner about what the tool returned (e.g.
  // "3 saved report(s)"). Never the full raw output.
  summary: z.string(),
});
export type DataChatToolTrace = z.infer<typeof DataChatToolTraceSchema>;

// A cited item from the org's OWN evidence library. `kind` records which tenant
// object it is; `ref` is the object's stable id/url. EVERY field originates from a
// tool result — the agent may reference a citation only by the number the server
// assigned it, so a citation can never point at data the tools didn't return.
export const DataCitationSchema = z.object({
  index: z.number().int().positive(),
  kind: z.enum(["evidence_report", "source", "claim"]),
  title: z.string().nullable(),
  ref: z.string(),
  // A UI-friendly relative link into the console for report/claim citations; null
  // for external source URLs (which carry their own absolute url in `ref`).
  href: z.string().nullable(),
});
export type DataCitation = z.infer<typeof DataCitationSchema>;

// The final assistant turn plus the full trace. `answer` is the grounded prose;
// `citations` is the deduped set of tenant objects the tools surfaced during the run.
export const DataChatResponseSchema = z.object({
  answer: z.string(),
  toolTrace: z.array(DataChatToolTraceSchema),
  citations: z.array(DataCitationSchema),
  // How many model turns the tool-use loop took (1 = answered with no tools).
  iterations: z.number().int().positive(),
});
export type DataChatResponse = z.infer<typeof DataChatResponseSchema>;
