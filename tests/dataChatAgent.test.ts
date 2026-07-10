import { describe, it, expect, vi, beforeEach } from "vitest";

// Agent-loop test for Data Chat — the conversational agent over ONE org's own
// evidence library. We stub @/lib/claude (no network / no API key) with a scripted
// Claude that first requests a tool, then — after the tool result is fed back —
// writes a final grounded answer. We stub the data-chat tool registry so the tool
// returns a known citation. This exercises the real loop AND the tenancy contract.
//
// Invariants asserted:
//  (1) a tool the model requested actually runs, and its citation surfaces on the
//      response indexed [1];
//  (2) the SERVER-supplied orgId is threaded into the tool executor (never a client
//      value) — the whole point of an org-scoped chat over tenant data;
//  (3) citations come ONLY from tool results, so a run with no tool call yields zero
//      citations even if the model names a report.

const createMock = vi.fn();

vi.mock("@/lib/claude", () => ({
  getClaude: () => ({ messages: { create: createMock } }),
  CLAUDE_MODEL: "test-model",
}));

// Stub the tool registry with a single deterministic list tool that returns one
// grounded citation into the org's own saved reports. Keeps the loop test
// independent of the DB / repositories.
const executeList = vi.fn(async () => ({
  output: { status: "found", total: 1 },
  citations: [
    {
      kind: "evidence_report" as const,
      title: "Statins reduce stroke risk",
      ref: "11111111-1111-1111-1111-111111111111",
      href: "/console/evidence-report/11111111-1111-1111-1111-111111111111",
    },
  ],
}));

vi.mock("@/lib/dataChat/tools", async () => {
  const { z } = await import("zod");
  const tool = {
    name: "list_evidence_reports",
    description: "list",
    inputSchema: z.object({ limit: z.number().int().positive().max(20).optional() }),
    jsonSchema: { type: "object", properties: {}, required: [] },
    execute: executeList,
  };
  return {
    DATA_CHAT_TOOLS: [tool],
    DATA_CHAT_TOOLS_BY_NAME: new Map([[tool.name, tool]]),
  };
});

// Import AFTER mocks are registered.
const { runDataChatTurn } = await import("@/lib/dataChat/agent");

const fakePool = {} as never;
const ORG_ID = "org-abc-123";

function toolUseResponse() {
  return {
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Let me check your saved reports." },
      { type: "tool_use", id: "tu_1", name: "list_evidence_reports", input: {} },
    ],
  };
}

function finalResponse(text: string) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

describe("runDataChatTurn", () => {
  beforeEach(() => {
    createMock.mockReset();
    executeList.mockClear();
  });

  it("runs the requested tool org-scoped, feeds the result back, and surfaces its citation", async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse())
      .mockResolvedValueOnce(finalResponse("Your library has 1 saved report [1]."));

    const result = await runDataChatTurn(
      [{ role: "user", content: "What have we saved?" }],
      fakePool,
      ORG_ID
    );

    // The tool actually ran.
    expect(executeList).toHaveBeenCalledOnce();
    // TENANCY: the server-resolved orgId is threaded as the tool's 3rd argument —
    // never a client value. (pool, orgId) => the executor's tenant scope.
    expect(executeList).toHaveBeenCalledWith({}, fakePool, ORG_ID);

    // Two model turns: request-tool, then answer.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.iterations).toBe(2);

    // The trace records the successful tool call.
    expect(result.toolTrace).toHaveLength(1);
    expect(result.toolTrace[0]).toMatchObject({ tool: "list_evidence_reports", ok: true });

    // The citation came from the tool result and is indexed [1], pointing at the
    // org's own saved report.
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      index: 1,
      kind: "evidence_report",
      ref: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.answer).toContain("[1]");
  });

  it("returns zero citations when the model answers without calling any tool", async () => {
    createMock.mockResolvedValueOnce(
      finalResponse("I can only answer from your organization's saved data.")
    );

    const result = await runDataChatTurn(
      [{ role: "user", content: "hello" }],
      fakePool,
      ORG_ID
    );

    expect(executeList).not.toHaveBeenCalled();
    expect(result.citations).toHaveLength(0);
    expect(result.toolTrace).toHaveLength(0);
    expect(result.iterations).toBe(1);
  });
});
