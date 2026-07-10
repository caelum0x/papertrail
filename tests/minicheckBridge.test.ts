import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bridge test for the MiniCheck fact-check engine (lib/engines/minicheck.ts). No Python,
// no model weights: we mock node:child_process.spawn with a fake child process so this
// runs in CI. It proves the bridge's contract — parse a well-formed { ok, results } into
// a typed MiniCheckResult, and REJECT (never throw to the caller) on every failure mode so
// callers fall back to the TS+Claude path. It also proves pairs go over stdin, not argv.

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

/** Queue stdout data + a close code on the next tick, after factCheck() attaches listeners. */
function emitRun(proc: ReturnType<typeof makeFakeChild>, stdoutData: string, code: number) {
  setImmediate(() => {
    if (stdoutData) proc.stdout.emit("data", stdoutData);
    proc.emit("close", code);
  });
}

async function loadBridge() {
  return import("../lib/engines/minicheck");
}

describe("isMiniCheckEnabled", () => {
  const original = process.env.MINICHECK_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.MINICHECK_ENABLED;
    else process.env.MINICHECK_ENABLED = original;
  });

  it("is opt-in: only true when the env flag is exactly 'true'", async () => {
    const { isMiniCheckEnabled } = await loadBridge();
    process.env.MINICHECK_ENABLED = "true";
    expect(isMiniCheckEnabled()).toBe(true);
    process.env.MINICHECK_ENABLED = "1";
    expect(isMiniCheckEnabled()).toBe(false);
    delete process.env.MINICHECK_ENABLED;
    expect(isMiniCheckEnabled()).toBe(false);
  });
});

describe("factCheck bridge", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("parses a well-formed { ok, results } into typed verdicts", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { factCheck } = await loadBridge();

    const payload = JSON.stringify({
      ok: true,
      results: [
        { claim: "Drug X reduced events by 30%.", supported: true, score: 0.91 },
        { claim: "Drug X cured all patients.", supported: false, score: 0.04 },
      ],
    });
    emitRun(proc, payload, 0);

    const result = await factCheck({
      pairs: [
        { claim: "Drug X reduced events by 30%.", doc: "Drug X reduced events by 30% versus placebo." },
        { claim: "Drug X cured all patients.", doc: "Drug X reduced events by 30% versus placebo." },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].supported).toBe(true);
    expect(result.results[0].score).toBeCloseTo(0.91);
    expect(result.results[1].supported).toBe(false);
  });

  it("sends pairs over stdin as JSON, not argv", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { factCheck } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, results: [] }), 0);
    await factCheck({ pairs: [{ claim: "c", doc: "d" }] });

    // Only the script path is passed as argv — no claim/doc text leaks into the process table.
    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv).toHaveLength(1);
    expect(argv[0]).toContain(["python", "minicheck", "run.py"].join(require("node:path").sep));
    expect(proc.stdin.written).toBe(JSON.stringify({ pairs: [{ claim: "c", doc: "d" }] }));
  });

  it("rejects when the engine reports { ok: false } (caller falls back)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { factCheck } = await loadBridge();

    // Exit 0 with an { ok: false } body: the bridge surfaces the engine's error message
    // (a non-zero exit is covered separately below).
    emitRun(proc, JSON.stringify({ ok: false, error: "RuntimeError: model load failed" }), 0);
    await expect(factCheck({ pairs: [{ claim: "c", doc: "d" }] })).rejects.toThrow(/model load failed/);
  });

  it("rejects on a non-zero exit code", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { factCheck } = await loadBridge();

    setImmediate(() => {
      proc.stderr.emit("data", "Traceback ...");
      proc.emit("close", 1);
    });
    await expect(factCheck({ pairs: [{ claim: "c", doc: "d" }] })).rejects.toThrow(/minicheck exited 1/);
  });

  it("rejects on unparseable stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { factCheck } = await loadBridge();

    emitRun(proc, "not json at all", 0);
    await expect(factCheck({ pairs: [{ claim: "c", doc: "d" }] })).rejects.toThrow(/parse minicheck output/);
  });

  it("rejects when ok is true but results is missing", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { factCheck } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true }), 0);
    await expect(factCheck({ pairs: [{ claim: "c", doc: "d" }] })).rejects.toThrow(/no results array/);
  });

  it("rejects (does not hang) when the subprocess exceeds the timeout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { factCheck } = await loadBridge();

    // Never emit close: the timeout must fire and SIGKILL the child.
    await expect(factCheck({ pairs: [{ claim: "c", doc: "d" }] }, 20)).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects when the process fails to spawn (e.g. python3 missing)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { factCheck } = await loadBridge();

    setImmediate(() => proc.emit("error", new Error("spawn python3 ENOENT")));
    await expect(factCheck({ pairs: [{ claim: "c", doc: "d" }] })).rejects.toThrow(/ENOENT/);
  });
});
