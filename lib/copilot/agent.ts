import type Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import { getClaude, CLAUDE_MODEL } from "@/lib/claude";
import { COPILOT_TOOLS, COPILOT_TOOLS_BY_NAME, type ToolCitation } from "./tools";
import type { CopilotMessage, CopilotResponse, ToolTrace, Citation } from "./schemas";

// THE RESEARCH COPILOT AGENT LOOP — the heart of the copilot and its heaviest,
// most genuine use of Claude. This is NOT thin RAG: Claude drives the whole
// interaction as a tool-using agent. Per user turn, Claude decides which of
// PaperTrail's engines to invoke (search / verify / synthesise), reads each tool
// result, chains further tool calls, and finally writes a grounded, cited answer.
//
// The deterministic engines are the TRUST LAYER that makes this heavy Claude use
// safe: every number and every source in the answer originates from a tool result
// (i.e. from retrieval + the deterministic verification/synthesis engines), never
// from the model's parametric memory. Citations are assigned server-side and the
// model may only reference them by index — so it structurally cannot fabricate a
// paper. Any run that finds no confident source ends in an honest "couldn't verify."

// Hard ceiling on model turns per request: bounds token spend and guarantees the
// loop terminates even if the model keeps requesting tools. Generous enough for a
// search → synthesise → verify chain, tight enough to never run away.
const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are PaperTrail's Research Copilot, an evidence-verification assistant for clinical-trial efficacy claims. You help translational researchers check whether a claim is supported by primary sources, and weigh the overall body of evidence.

You have three tools, each backed by PaperTrail's deterministic engines:
- search_sources: find relevant cached primary sources (PubMed / ClinicalTrials.gov).
- verify_claim: verify one specific claim against its primary source (trust score, discrepancy type, grounded flagged spans, deterministic effect-size and registry cross-checks).
- run_synthesis: pool a body of evidence across trials (meta-analysis, publication-bias, GRADE certainty) — all numbers computed deterministically.

RULES — these are non-negotiable:
1. NEVER state a numeric result (effect size, trust score, GRADE rating, p-value, confidence interval, hazard/risk/odds ratio) unless it came from a tool result in THIS conversation. Do not compute or recall numbers yourself.
2. NEVER cite, name, or describe a paper or trial that did not appear in a tool result. When you reference a source, cite it by the bracketed number the tool results carry (e.g. [1], [2]).
3. If the tools return "no confident match" / "no support found" / "insufficient", say so plainly. An honest "I could not verify this against a retrievable source" is the correct answer — do not fill the gap with general knowledge.
4. Prefer to call a tool over answering from memory whenever the question is about a specific claim, effect size, or body of evidence. Use search_sources first when you are unsure what evidence exists.
5. Be concise and precise. Lead with the verdict, then the supporting detail, then the caveats. This audience is translational-research staff; use accurate statistical language.

When you have gathered enough grounded information, write your final answer with inline [n] citations that map to the sources the tools returned.`;

// Convert the client-supplied conversation into Anthropic message params. Only
// user/assistant text turns cross the boundary; tool plumbing is server-internal.
function toAnthropicMessages(messages: CopilotMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

// Stable key so the same physical source cited by two different tools dedupes to
// one citation index rather than appearing twice.
function citationKey(c: ToolCitation): string {
  return `${c.source_type}:${c.external_id ?? c.url}`;
}

// A one-line, safe summary of a tool result for the trace pill (never the full
// output — that stays between the agent and the model).
function summarizeToolOutput(toolName: string, output: unknown): string {
  if (output === null || typeof output !== "object") return "done";
  const o = output as Record<string, unknown>;

  if (toolName === "search_sources") {
    if (o.status === "no_confident_match") return "no confident match";
    return `found ${o.count ?? 0} source(s)`;
  }
  if (toolName === "verify_claim") {
    if (o.status === "no_support_found") return "no support found";
    const v = o.verification as Record<string, unknown> | undefined;
    const parts = ["verified"];
    if (v && typeof v.trust_score === "number") parts.push(`trust ${v.trust_score}`);
    if (v && typeof v.discrepancy_type === "string") parts.push(String(v.discrepancy_type));
    return parts.join(" · ");
  }
  if (toolName === "run_synthesis") {
    const r = o.report as Record<string, unknown> | undefined;
    if (!r || r.ok !== true) return "insufficient evidence to pool";
    const certainty =
      (r.certainty as Record<string, unknown> | undefined)?.certainty ?? "?";
    const verdict = (r.verdict as Record<string, unknown> | undefined)?.verdict ?? "?";
    return `pooled · GRADE ${certainty} · ${verdict}`;
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

// The Anthropic tool definitions, derived from the copilot tool registry.
const ANTHROPIC_TOOLS: Anthropic.Tool[] = COPILOT_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.jsonSchema as Anthropic.Tool.InputSchema,
}));

/**
 * Run one Research Copilot turn: an agentic tool-use loop over PaperTrail's
 * engines. Claude reads the conversation, decides which tools to call, executes
 * them (via the injected pool), feeds results back, and iterates until it produces
 * a final grounded answer or the iteration ceiling is hit.
 *
 * Returns the final answer, the full tool trace (for transparency in the UI), the
 * deduped citation list (assigned server-side; the model can only reference these),
 * and how many model turns the loop took. Never throws for expected states — a run
 * that finds no evidence returns an honest answer, not an error.
 */
export async function runCopilotTurn(
  messages: CopilotMessage[],
  pool: Pool
): Promise<CopilotResponse> {
  const anthropic = getClaude();
  const convo: Anthropic.MessageParam[] = toAnthropicMessages(messages);

  const toolTrace: ToolTrace[] = [];

  // Citation registry: physical source key -> assigned 1-based index. Populated
  // ONLY from tool results, so the final answer can cite only what tools returned.
  const citationIndex = new Map<string, number>();
  const citations: Citation[] = [];

  function registerCitations(toolCitations: ToolCitation[]): void {
    for (const c of toolCitations) {
      const key = citationKey(c);
      if (citationIndex.has(key)) continue;
      const index = citations.length + 1;
      citationIndex.set(key, index);
      citations.push({
        index,
        title: c.title,
        url: c.url,
        source_type: c.source_type,
        external_id: c.external_id,
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
      // Model produced its final answer (end_turn / max_tokens / stop_sequence).
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
      const tool = COPILOT_TOOLS_BY_NAME.get(block.name);
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
        const result = await tool.execute(parsed.data, pool);
        registerCitations(result.citations);

        // Annotate the output the model sees with the server-assigned citation
        // indices, so the model cites [n] with n it can actually justify.
        const citedOutput = {
          ...(result.output as Record<string, unknown>),
          _cited_sources: result.citations.map((c) => ({
            index: citationIndex.get(citationKey(c)),
            title: c.title,
            external_id: c.external_id,
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
          content: "The tool failed to run. Do not fabricate a result; tell the user this step could not complete.",
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
            "Based only on the tool results already gathered, give your best grounded answer now with [n] citations. Do not request more tools. If the evidence was insufficient, say so honestly.",
        },
      ],
    });
    finalText = extractText(closing.content);
    iterations += 1;
  }

  if (finalText.length === 0) {
    finalText =
      "I wasn't able to produce a grounded answer for this request. Try rephrasing the claim, or ask about a specific efficacy statement I can verify against a primary source.";
  }

  return { answer: finalText, toolTrace, citations, iterations };
}
