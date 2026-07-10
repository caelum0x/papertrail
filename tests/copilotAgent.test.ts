import { describe, it, expect, vi, beforeEach } from "vitest";

// Agent-loop test for the Research Copilot. We stub @/lib/claude (so no network /
// no API key) with a scripted Claude that first requests a tool, then — after the
// tool result is fed back — writes a final answer. We stub the copilot tool
// registry so the tool returns a known citation. This exercises the real loop:
// tool_use → execute → register citation → feed result back → final grounded answer.
//
// The two invariants asserted: (1) a tool the model requested actually runs and its
// citation surfaces on the response; (2) citations come ONLY from tool results, so a
// run with no tool call yields zero citations even if the model names a source.

const createMock = vi.fn();

vi.mock("@/lib/claude", () => ({
  getClaude: () => ({ messages: { create: createMock } }),
  CLAUDE_MODEL: "test-model",
}));

// Stub the tool registry with a single deterministic search tool that returns one
// grounded citation. Keeps the agent-loop test independent of retrieval/DB.
const executeSearch = vi.fn(async () => ({
  output: { status: "found", count: 1 },
  citations: [
    {
      title: "Trial A: efficacy of Drug X",
      url: "https://clinicaltrials.gov/study/NCT001",
      source_type: "clinicaltrials",
      external_id: "NCT001",
    },
  ],
}));

vi.mock("@/lib/copilot/tools", async () => {
  const { z } = await import("zod");
  const tool = {
    name: "search_sources",
    description: "search",
    inputSchema: z.object({ query: z.string() }),
    jsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    execute: executeSearch,
  };
  return {
    COPILOT_TOOLS: [tool],
    COPILOT_TOOLS_BY_NAME: new Map([[tool.name, tool]]),
  };
});

// Import AFTER mocks are registered.
const { runCopilotTurn } = await import("@/lib/copilot/agent");

const fakePool = {} as never;

function toolUseResponse() {
  return {
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Let me search for evidence." },
      { type: "tool_use", id: "tu_1", name: "search_sources", input: { query: "Drug X" } },
    ],
  };
}

function finalResponse(text: string) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

describe("runCopilotTurn", () => {
  beforeEach(() => {
    createMock.mockReset();
    executeSearch.mockClear();
  });

  it("executes a requested tool, feeds the result back, and surfaces its citation", async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse())
      .mockResolvedValueOnce(finalResponse("Drug X shows a benefit in trial [1]."));

    const result = await runCopilotTurn(
      [{ role: "user", content: "Is Drug X effective?" }],
      fakePool
    );

    // The tool actually ran.
    expect(executeSearch).toHaveBeenCalledOnce();
    // Two model turns: request-tool, then answer.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.iterations).toBe(2);

    // The trace records the successful tool call.
    expect(result.toolTrace).toHaveLength(1);
    expect(result.toolTrace[0]).toMatchObject({ tool: "search_sources", ok: true });

    // The citation came from the tool result and is indexed [1].
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ index: 1, external_id: "NCT001" });
    expect(result.answer).toContain("[1]");
  });

  it("returns zero citations when the model answers without calling any tool", async () => {
    createMock.mockResolvedValueOnce(
      finalResponse("I can only verify claims against retrievable sources.")
    );

    const result = await runCopilotTurn(
      [{ role: "user", content: "hello" }],
      fakePool
    );

    expect(executeSearch).not.toHaveBeenCalled();
    expect(result.citations).toHaveLength(0);
    expect(result.toolTrace).toHaveLength(0);
    expect(result.iterations).toBe(1);
  });
});
