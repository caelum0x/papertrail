import type Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import { getClaude, CLAUDE_MODEL } from "@/lib/claude";
import {
  DATA_CHAT_TOOLS,
  DATA_CHAT_TOOLS_BY_NAME,
  type DataToolCitation,
} from "./tools";
import type {
  DataChatMessage,
  DataChatResponse,
  DataChatToolTrace,
  DataCitation,
} from "./schemas";

// THE DATA-CHAT AGENT LOOP — a conversational Claude tool-use agent scoped to ONE
// ORG's own evidence library. Same shape as the public Research Copilot loop, but
// every tool runs against tenant data (saved reports, cached sources, claims) and is
// invoked with the SERVER-resolved `orgId` — never a client value. Per user turn,
// Claude decides which org-scoped tools to call, reads each result, chains further
// calls, and finally writes a grounded, cited answer about the org's own work.
//
// The org-scoped repositories are the TRUST LAYER that makes this heavy Claude use
// safe over tenant data: every fact, number, and citation in the answer originates
// from a tool result (each org_id-filtered), never from the model's parametric
// memory. Citations are assigned server-side and the model may only reference them
// by index — so it structurally cannot fabricate a report, source, or claim, nor
// leak across tenants.

// Hard ceiling on model turns per request: bounds token spend and guarantees the
// loop terminates even if the model keeps requesting tools.
const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are PaperTrail's Data Chat, an assistant that answers questions about ONE organization's own evidence library: its saved evidence reports, the primary sources it verifies against, and the efficacy claims it tracks.

You have five tools, each reading ONLY this organization's data:
- list_evidence_reports: list the org's saved evidence reports with certainty/verdict analytics.
- get_evidence_report: fetch the full stored payload (pooled effect, GRADE rationale, flagged spans) of one saved report.
- search_org_sources: semantically search the cached primary-source library (PubMed / ClinicalTrials.gov).
- search_claims: list the org's own filed claims, optionally filtered by text or status.
- get_claim: fetch one of the org's claims in full.

RULES — these are non-negotiable:
1. NEVER state a fact, number (effect size, trust score, GRADE rating, count, p-value, confidence interval, ratio), report, source, or claim unless it came from a tool result in THIS conversation. Do not compute or recall anything yourself. Every number is quoted from a stored report or source the tools returned.
2. NEVER cite, name, or describe a saved report, source, or claim that did not appear in a tool result. When you reference one, cite it by the bracketed number the tool results carry (e.g. [1], [2]).
3. If the tools return "empty" / "not found" / "no confident match", say so plainly. "This organization has no saved reports on that topic" is the correct answer — do not fill the gap with general knowledge or invent data.
4. Prefer to call a tool over answering from memory whenever the question is about the org's saved work, its claims, or specific sources. Start with a list/search tool when you are unsure what exists, then drill in with a get tool.
5. Be concise and precise. Lead with the answer, then the supporting detail, then caveats. The audience is translational-research staff; use accurate statistical language.

When you have gathered enough grounded information, write your final answer with inline [n] citations that map to the org's own reports/sources/claims the tools returned.`;

// Convert the client-supplied conversation into Anthropic message params. Only
// user/assistant text turns cross the boundary; tool plumbing is server-internal.
function toAnthropicMessages(messages: DataChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

// Stable key so the same physical object cited by two different tools dedupes to one
// citation index rather than appearing twice.
function citationKey(c: DataToolCitation): string {
  return `${c.kind}:${c.ref}`;
}

// A one-line, safe summary of a tool result for the trace pill (never the full
// output — that stays between the agent and the model).
function summarizeToolOutput(toolName: string, output: unknown): string {
  if (output === null || typeof output !== "object") return "done";
  const o = output as Record<string, unknown>;
  const status = typeof o.status === "string" ? o.status : undefined;

  if (toolName === "list_evidence_reports") {
    if (status === "empty") return "no saved reports";
    return `${o.total ?? 0} saved report(s)`;
  }
  if (toolName === "get_evidence_report") {
    if (status === "not_found") return "report not found";
    const certainty = typeof o.certainty === "string" ? o.certainty : "?";
    const verdict = typeof o.verdict === "string" ? o.verdict : "?";
    return `report · ${verdict} · GRADE ${certainty}`;
  }
  if (toolName === "search_org_sources") {
    if (status === "no_confident_match") return "no confident match";
    return `found ${o.count ?? 0} source(s)`;
  }
  if (toolName === "search_claims") {
    if (status === "empty") return "no matching claims";
    return `${o.total ?? 0} claim(s)`;
  }
  if (toolName === "get_claim") {
    if (status === "not_found") return "claim not found";
    return `claim · ${o.status_value ?? "?"}`;
  }
  return "done";
}

// Extract the concatenated text of the model's final (non-tool) turn.
function extractText(content: Anthropic.Message["content"]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// The Anthropic tool definitions, derived from the data-chat tool registry.
const ANTHROPIC_TOOLS: Anthropic.Tool[] = DATA_CHAT_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.jsonSchema as Anthropic.Tool.InputSchema,
}));

/**
 * Run one Data Chat turn: an agentic tool-use loop over the org's OWN evidence
 * library. Claude reads the conversation, decides which org-scoped tools to call,
 * executes them (with the server-supplied `orgId` — never a client value), feeds
 * results back, and iterates until it produces a final grounded answer or the
 * iteration ceiling is hit.
 *
 * `orgId` MUST come from the request's resolved org context (withOrg → ctx.org.id).
 * Every tool call threads it as the tenant scope; there is no path that runs a tool
 * without it.
 *
 * Returns the final answer, the full tool trace, the deduped citation list (assigned
 * server-side; the model can only reference these), and how many model turns the
 * loop took. Never throws for expected states — a run that finds no matching tenant
 * data returns an honest answer, not an error.
 */
export async function runDataChatTurn(
  messages: DataChatMessage[],
  pool: Pool,
  orgId: string
): Promise<DataChatResponse> {
  const anthropic = getClaude();
  const convo: Anthropic.MessageParam[] = toAnthropicMessages(messages);

  const toolTrace: DataChatToolTrace[] = [];

  // Citation registry: object key -> assigned 1-based index. Populated ONLY from
  // tool results, so the final answer can cite only what the org-scoped tools
  // returned.
  const citationIndex = new Map<string, number>();
  const citations: DataCitation[] = [];

  function registerCitations(toolCitations: DataToolCitation[]): void {
    for (const c of toolCitations) {
      const key = citationKey(c);
      if (citationIndex.has(key)) continue;
      const index = citations.length + 1;
      citationIndex.set(key, index);
      citations.push({
        index,
        kind: c.kind,
        title: c.title,
        ref: c.ref,
        href: c.href,
      });
    }
  }

  let iterations = 0;
  let finalText = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations = i + 1;

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: ANTHROPIC_TOOLS,
      messages: convo,
    });

    // Persist the assistant turn (may contain text + tool_use blocks) so the
    // conversation stays valid when we append the tool_result user turn.
    convo.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      finalText = extractText(response.content);
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    // Execute every requested tool and gather all results into ONE user turn (the
    // API requires all tool_result blocks for a turn in a single message).
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      const tool = DATA_CHAT_TOOLS_BY_NAME.get(block.name);
      const start = Date.now();

      if (!tool) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}.`,
          is_error: true,
        });
        toolTrace.push({
          tool: block.name,
          input: (block.input as Record<string, unknown>) ?? {},
          ok: false,
          error: `Unknown tool: ${block.name}.`,
          durationMs: Date.now() - start,
          summary: "unknown tool",
        });
        continue;
      }

      const parsed = tool.inputSchema.safeParse(block.input);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "Invalid tool input.";
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Invalid input: ${message}`,
          is_error: true,
        });
        toolTrace.push({
          tool: block.name,
          input: (block.input as Record<string, unknown>) ?? {},
          ok: false,
          error: message,
          durationMs: Date.now() - start,
          summary: "invalid input",
        });
        continue;
      }

      try {
        // orgId is the server-resolved tenant scope — always passed, never client-
        // supplied. Every underlying query filters on it as its first predicate.
        const result = await tool.execute(parsed.data, pool, orgId);
        registerCitations(result.citations);

        // Annotate the output the model sees with the server-assigned citation
        // indices, so the model cites [n] with n it can actually justify.
        const citedOutput = {
          ...(result.output as Record<string, unknown>),
          _cited_sources: result.citations.map((c) => ({
            index: citationIndex.get(citationKey(c)),
            kind: c.kind,
            title: c.title,
            ref: c.ref,
          })),
        };

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(citedOutput),
        });
        toolTrace.push({
          tool: block.name,
          input: parsed.data as Record<string, unknown>,
          ok: true,
          error: null,
          durationMs: Date.now() - start,
          summary: summarizeToolOutput(block.name, result.output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool execution failed.";
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content:
            "The tool failed to run. Do not fabricate a result; tell the user this step could not complete.",
          is_error: true,
        });
        toolTrace.push({
          tool: block.name,
          input: parsed.data as Record<string, unknown>,
          ok: false,
          error: message,
          durationMs: Date.now() - start,
          summary: "tool error",
        });
      }
    }

    convo.push({ role: "user", content: toolResults });
  }

  // If we exhausted the loop still wanting tools, ask once more for a final answer
  // without tools so the user never gets an empty response.
  if (finalText.length === 0) {
    const closing = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [
        ...convo,
        {
          role: "user",
          content:
            "Based only on the tool results already gathered, give your best grounded answer now with [n] citations. Do not request more tools. If no matching data was found in this organization's library, say so honestly.",
        },
      ],
    });
    finalText = extractText(closing.content);
    iterations += 1;
  }

  if (finalText.length === 0) {
    finalText =
      "I wasn't able to produce a grounded answer for this request. Try rephrasing, or ask about a specific saved report, source, or claim in your organization's library.";
  }

  return { answer: finalText, toolTrace, citations, iterations };
}
