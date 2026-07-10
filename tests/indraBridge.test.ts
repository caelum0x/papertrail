import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bridge test for the INDRA mechanism-assembly engine (lib/engines/indra.ts). No
// Python, no INDRA install: we mock node:child_process.spawn with a fake child
// process so this runs in CI. It proves the bridge's contract — parse a well-formed
// { ok, reader, statements } into a typed IndraResult, and REJECT (never throw to the
// caller) on every failure mode so callers fall back. It also proves the request goes
// over stdin (not argv) so no claim/source text leaks into the process table, and that
// the engine is opt-in (disabled -> reject without spawning).

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

/** Queue stdout data + a close code on the next tick, after assembleMechanisms() attaches listeners. */
function emitRun(proc: ReturnType<typeof makeFakeChild>, stdoutData: string, code: number) {
  setImmediate(() => {
    if (stdoutData) proc.stdout.emit("data", stdoutData);
    proc.emit("close", code);
  });
}

async function loadBridge() {
  return import("../lib/engines/indra");
}

const INPUT = {
  text: "BRAF activates MAP2K1, which phosphorylates MAPK1.",
  citation: "34567890",
};

const OK_PAYLOAD = {
  ok: true,
  reader: "reach",
  statements: [
    {
      type: "Activation",
      subj: "BRAF",
      obj: "MAP2K1",
      belief: 0.86,
      evidence: [
        { source: "reach", text: "BRAF activates MAP2K1.", pmid: "34567890" },
      ],
    },
  ],
};

describe("isIndraEnabled", () => {
  const original = process.env.INDRA_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.INDRA_ENABLED;
    else process.env.INDRA_ENABLED = original;
  });

  it("is opt-in: only true when the env flag is exactly 'true'", async () => {
    const { isIndraEnabled } = await loadBridge();
    process.env.INDRA_ENABLED = "true";
    expect(isIndraEnabled()).toBe(true);
    process.env.INDRA_ENABLED = "1";
    expect(isIndraEnabled()).toBe(false);
    delete process.env.INDRA_ENABLED;
    expect(isIndraEnabled()).toBe(false);
  });
});

describe("assembleMechanisms disabled/fallback", () => {
  const original = process.env.INDRA_ENABLED;
  beforeEach(() => spawnMock.mockReset());
  afterEach(() => {
    if (original === undefined) delete process.env.INDRA_ENABLED;
    else process.env.INDRA_ENABLED = original;
  });

  it("rejects without spawning when the engine is disabled (caller falls back)", async () => {
    delete process.env.INDRA_ENABLED;
    const { assembleMechanisms } = await loadBridge();
    await expect(assembleMechanisms(INPUT)).rejects.toThrow(/disabled/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects on invalid input (no text and no genes) without spawning", async () => {
    process.env.INDRA_ENABLED = "true";
    const { assembleMechanisms } = await loadBridge();
    await expect(assembleMechanisms({})).rejects.toThrow(/required/);
    await expect(assembleMechanisms({ text: "   ", genes: [] })).rejects.toThrow(/required/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("assembleMechanisms bridge", () => {
  const original = process.env.INDRA_ENABLED;
  beforeEach(() => {
    spawnMock.mockReset();
    process.env.INDRA_ENABLED = "true";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.INDRA_ENABLED;
    else process.env.INDRA_ENABLED = original;
  });

  it("parses a well-formed { ok, reader, statements } into a typed result", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { assembleMechanisms } = await loadBridge();

    emitRun(proc, JSON.stringify(OK_PAYLOAD), 0);
    const result = await assembleMechanisms(INPUT);

    expect(result.ok).toBe(true);
    expect(result.reader).toBe("reach");
    expect(result.statements).toHaveLength(1);
    const stmt = result.statements[0];
    expect(stmt.type).toBe("Activation");
    expect(stmt.subj).toBe("BRAF");
    expect(stmt.obj).toBe("MAP2K1");
    expect(stmt.belief).toBeCloseTo(0.86);
    expect(stmt.evidence[0].source).toBe("reach");
    expect(stmt.evidence[0].text).toContain("BRAF activates MAP2K1");
    expect(stmt.evidence[0].pmid).toBe("34567890");
  });

  it("sends the request over stdin as JSON, not argv (no claim text leaks)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { assembleMechanisms } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, reader: "reach", statements: [] }), 0);
    await assembleMechanisms(INPUT);

    // Only the script path is passed as argv — no claim/source text in argv.
    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv).toHaveLength(1);
    expect(argv[0]).toContain(["python", "indra", "run.py"].join(require("node:path").sep));

    const sent = JSON.parse(proc.stdin.written);
    expect(sent.text).toBe(INPUT.text);
    expect(sent.citation).toBe(INPUT.citation);
  });

  it("maps camelCase tuning options to the snake_case the script expects", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { assembleMechanisms } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, reader: "pathway_commons", statements: [] }), 0);
    await assembleMechanisms({ genes: ["BRAF", "MAP2K1"], neighborLimit: 2, maxStatements: 50 });

    const sent = JSON.parse(proc.stdin.written);
    expect(sent.genes).toEqual(["BRAF", "MAP2K1"]);
    expect(sent.neighbor_limit).toBe(2);
    expect(sent.max_statements).toBe(50);
  });

  it("rejects when the engine reports { ok: false } (caller falls back)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { assembleMechanisms } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: false, error: "ValueError: reader 'eidos' is not a configured free reader" }), 1);
    await expect(assembleMechanisms(INPUT)).rejects.toThrow(/not a configured free reader/);
  });

  it("rejects on a non-zero exit with no stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { assembleMechanisms } = await loadBridge();

    setImmediate(() => {
      proc.stderr.emit("data", "Traceback ...");
      proc.emit("close", 1);
    });
    await expect(assembleMechanisms(INPUT)).rejects.toThrow(/indra exited 1/);
  });

  it("rejects on unparseable stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { assembleMechanisms } = await loadBridge();

    emitRun(proc, "not json at all", 0);
    await expect(assembleMechanisms(INPUT)).rejects.toThrow(/parse indra output/);
  });

  it("rejects (does not hang) when the subprocess exceeds the timeout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { assembleMechanisms } = await loadBridge();

    // Never emit close: the timeout must fire and SIGKILL the child.
    await expect(assembleMechanisms(INPUT, 20)).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects when the process fails to spawn (e.g. python3 missing)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { assembleMechanisms } = await loadBridge();

    setImmediate(() => proc.emit("error", new Error("spawn python3 ENOENT")));
    await expect(assembleMechanisms(INPUT)).rejects.toThrow(/ENOENT/);
  });
});
