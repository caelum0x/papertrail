import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bridge test for the PaperQA2 engine (lib/engines/paperqa.ts). No Python, no models:
// we mock node:child_process.spawn with a fake child process so this runs in CI. It
// proves the bridge's contract — parse a well-formed { ok, answer, contexts, references }
// into a typed PaperQaResult, and REJECT (never throw to the caller) on every failure
// mode so callers fall back to the TS+Claude path. It also proves the request goes over
// stdin (not argv) so no question/source text leaks into the process table, and that the
// engine is opt-in (disabled -> reject without spawning).

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

/** A minimal fake ChildProcess: emitters for stdout/stderr/close plus a capturing stdin. */
function makeFakeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { written: string; write: (s: string) => void; end: () => void; on: () => void };
    kill: (sig?: string) => void;
  };
  const stdin = {
    written: "",
    write(s: string) {
      this.written += s;
    },
    end() {},
    on() {},
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  proc.kill = vi.fn();
  return proc;
}

/** Queue stdout data + a close code on the next tick, after askPaperQa() attaches listeners. */
function emitRun(proc: ReturnType<typeof makeFakeChild>, stdoutData: string, code: number) {
  setImmediate(() => {
    if (stdoutData) proc.stdout.emit("data", stdoutData);
    proc.emit("close", code);
  });
}

async function loadBridge() {
  return import("../lib/engines/paperqa");
}

const INPUT = {
  question: "Did drug X reduce events by 30%?",
  texts: [{ name: "NCT001", text: "Drug X reduced major events by 30% versus placebo." }],
};

describe("isPaperQaEnabled", () => {
  const original = process.env.PAPERQA_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.PAPERQA_ENABLED;
    else process.env.PAPERQA_ENABLED = original;
  });

  it("is opt-in: only true when the env flag is exactly 'true'", async () => {
    const { isPaperQaEnabled } = await loadBridge();
    process.env.PAPERQA_ENABLED = "true";
    expect(isPaperQaEnabled()).toBe(true);
    process.env.PAPERQA_ENABLED = "1";
    expect(isPaperQaEnabled()).toBe(false);
    delete process.env.PAPERQA_ENABLED;
    expect(isPaperQaEnabled()).toBe(false);
  });
});

describe("askPaperQa disabled/fallback", () => {
  const original = process.env.PAPERQA_ENABLED;
  beforeEach(() => spawnMock.mockReset());
  afterEach(() => {
    if (original === undefined) delete process.env.PAPERQA_ENABLED;
    else process.env.PAPERQA_ENABLED = original;
  });

  it("rejects without spawning when the engine is disabled (caller falls back)", async () => {
    delete process.env.PAPERQA_ENABLED;
    const { askPaperQa } = await loadBridge();
    await expect(askPaperQa(INPUT)).rejects.toThrow(/disabled/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects on invalid input (empty texts) without spawning", async () => {
    process.env.PAPERQA_ENABLED = "true";
    const { askPaperQa } = await loadBridge();
    await expect(askPaperQa({ question: "q", texts: [] })).rejects.toThrow(/required/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("askPaperQa bridge", () => {
  const original = process.env.PAPERQA_ENABLED;
  beforeEach(() => {
    spawnMock.mockReset();
    process.env.PAPERQA_ENABLED = "true";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PAPERQA_ENABLED;
    else process.env.PAPERQA_ENABLED = original;
  });

  it("parses a well-formed { ok, answer, contexts, references } into a typed result", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { askPaperQa } = await loadBridge();

    const payload = JSON.stringify({
      ok: true,
      answer: "Yes, drug X reduced events by 30% (NCT001).",
      contexts: [
        {
          text: "Drug X reduced major events by 30% versus placebo.",
          name: "NCT001 chunk 1",
          score: 8,
          summary: "Reports a 30% reduction in major events.",
        },
      ],
      references: "1. (NCT001): trial abstract",
    });
    emitRun(proc, payload, 0);

    const result = await askPaperQa(INPUT);

    expect(result.ok).toBe(true);
    expect(result.answer).toMatch(/30%/);
    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0].name).toBe("NCT001 chunk 1");
    expect(result.contexts[0].score).toBe(8);
    expect(result.contexts[0].text).toContain("30% versus placebo");
    expect(result.references).toContain("NCT001");
  });

  it("sends the request over stdin as JSON, not argv", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { askPaperQa } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, answer: "", contexts: [], references: "" }), 0);
    await askPaperQa(INPUT);

    // Only the script path is passed as argv — no question/source text leaks into argv.
    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv).toHaveLength(1);
    expect(argv[0]).toContain(["python", "paperqa", "run.py"].join(require("node:path").sep));

    const sent = JSON.parse(proc.stdin.written);
    expect(sent.question).toBe(INPUT.question);
    expect(sent.texts).toEqual(INPUT.texts);
  });

  it("maps camelCase tuning options to the snake_case the script expects", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { askPaperQa } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, answer: "", contexts: [], references: "" }), 0);
    await askPaperQa({ ...INPUT, summaryLlm: "claude-x", answerMaxSources: 4, evidenceK: 12 });

    const sent = JSON.parse(proc.stdin.written);
    expect(sent.summary_llm).toBe("claude-x");
    expect(sent.answer_max_sources).toBe(4);
    expect(sent.evidence_k).toBe(12);
  });

  it("rejects when the engine reports { ok: false } (caller falls back)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { askPaperQa } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: false, error: "ValueError: no usable source texts to index" }), 1);
    await expect(askPaperQa(INPUT)).rejects.toThrow(/no usable source texts/);
  });

  it("rejects on a non-zero exit with no stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { askPaperQa } = await loadBridge();

    setImmediate(() => {
      proc.stderr.emit("data", "Traceback ...");
      proc.emit("close", 1);
    });
    await expect(askPaperQa(INPUT)).rejects.toThrow(/paperqa exited 1/);
  });

  it("rejects on unparseable stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { askPaperQa } = await loadBridge();

    emitRun(proc, "not json at all", 0);
    await expect(askPaperQa(INPUT)).rejects.toThrow(/parse paperqa output/);
  });

  it("rejects (does not hang) when the subprocess exceeds the timeout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { askPaperQa } = await loadBridge();

    // Never emit close: the timeout must fire and SIGKILL the child.
    await expect(askPaperQa(INPUT, 20)).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects when the process fails to spawn (e.g. python3 missing)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { askPaperQa } = await loadBridge();

    setImmediate(() => proc.emit("error", new Error("spawn python3 ENOENT")));
    await expect(askPaperQa(INPUT)).rejects.toThrow(/ENOENT/);
  });
});
