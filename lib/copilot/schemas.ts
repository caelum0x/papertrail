import { z } from "zod";

// Request/response contract for the Research Copilot — a conversational Claude
// agent (tool-use) that drives PaperTrail's verification + synthesis engines.
//
// The wire contract is deliberately small: the client sends a running list of
// user/assistant turns; the server runs the tool-use loop and returns the final
// assistant turn PLUS a transparent trace (which tools ran, with what input, and
// what they returned) and the citation list. Citations only ever come from tool
// results — never fabricated by the model — so `grounded` holds by construction.

// One chat turn on the wire. Only user/assistant roles cross the boundary; the
// system prompt and tool plumbing live server-side and are never client-supplied.
export const CopilotMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});
export type CopilotMessage = z.infer<typeof CopilotMessageSchema>;

// Public request: the conversation so far. Bounded so a caller can't smuggle an
// unbounded history (token-burn / abuse). The final turn should be from the user.
export const CopilotRequestSchema = z.object({
  messages: z.array(CopilotMessageSchema).min(1).max(40),
});
export type CopilotRequest = z.infer<typeof CopilotRequestSchema>;

// A single tool invocation the agent made, surfaced to the UI as a trace pill.
// `ok=false` carries the sanitized error the executor returned (never a stack).
export const ToolTraceSchema = z.object({
  tool: z.string(),
  input: z.record(z.unknown()),
  ok: z.boolean(),
  error: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  // A compact, human-readable one-liner about what the tool returned (e.g.
  // "verified · trust 45 · magnitude_overstated"). Never the full raw output.
  summary: z.string(),
});
export type ToolTrace = z.infer<typeof ToolTraceSchema>;

// A cited primary source. EVERY field here originates from a tool result — the
// agent may reference a citation only by the number the server assigned it, so a
// citation can never point at a source the tools didn't actually return.
export const CitationSchema = z.object({
  index: z.number().int().positive(),
  title: z.string().nullable(),
  url: z.string(),
  source_type: z.string(),
  external_id: z.string().nullable(),
});
export type Citation = z.infer<typeof CitationSchema>;

// The final assistant turn plus the full trace. `answer` is the grounded prose;
// `citations` is the deduped set of sources the tools surfaced during the run.
export const CopilotResponseSchema = z.object({
  answer: z.string(),
  toolTrace: z.array(ToolTraceSchema),
  citations: z.array(CitationSchema),
  // How many model turns the tool-use loop took (1 = answered with no tools).
  iterations: z.number().int().positive(),
});
export type CopilotResponse = z.infer<typeof CopilotResponseSchema>;
