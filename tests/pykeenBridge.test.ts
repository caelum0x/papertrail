import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bridge test for the PyKEEN link-prediction engine (lib/engines/pykeen.ts). No Python,
// no torch, no training: we mock node:child_process.spawn with a fake child process so
// this runs in CI. It proves the bridge's contract — parse a well-formed
// { ok, model, epochs, target, predictions } into a typed PyKeenResult, and REJECT
// (never throw to the caller) on every failure mode so callers fall back. It also proves
// the request goes over stdin (not argv) so no triples / prediction target leak into the
// process table, and that the engine is opt-in (disabled -> reject without spawning).

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

/** Queue stdout data + a close code on the next tick, after predictLinks() attaches listeners. */
function emitRun(proc: ReturnType<typeof makeFakeChild>, stdoutData: string, code: number) {
  setImmediate(() => {
    if (stdoutData) proc.stdout.emit("data", stdoutData);
    proc.emit("close", code);
  });
}

async function loadBridge() {
  return import("../lib/engines/pykeen");
}

const INPUT = {
  triples: [
    ["drugA", "treats", "diseaseX"],
    ["drugB", "treats", "diseaseX"],
    ["drugA", "targets", "geneY"],
    ["drugB", "targets", "geneY"],
  ] as Array<[string, string, string]>,
  // Fix head + relation, leave tail undefined -> predict the tail.
  predict: { head: "drugA", relation: "treats" },
};

describe("isPyKeenEnabled", () => {
  const original = process.env.PYKEEN_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.PYKEEN_ENABLED;
    else process.env.PYKEEN_ENABLED = original;
  });

  it("is opt-in: only true when the env flag is exactly 'true'", async () => {
    const { isPyKeenEnabled } = await loadBridge();
    process.env.PYKEEN_ENABLED = "true";
    expect(isPyKeenEnabled()).toBe(true);
    process.env.PYKEEN_ENABLED = "1";
    expect(isPyKeenEnabled()).toBe(false);
    delete process.env.PYKEEN_ENABLED;
    expect(isPyKeenEnabled()).toBe(false);
  });
});

describe("predictLinks disabled/fallback", () => {
  const original = process.env.PYKEEN_ENABLED;
  beforeEach(() => spawnMock.mockReset());
  afterEach(() => {
    if (original === undefined) delete process.env.PYKEEN_ENABLED;
    else process.env.PYKEEN_ENABLED = original;
  });

  it("rejects without spawning when the engine is disabled (caller falls back)", async () => {
    delete process.env.PYKEEN_ENABLED;
    const { predictLinks } = await loadBridge();
    await expect(predictLinks(INPUT)).rejects.toThrow(/disabled/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects on empty triples without spawning", async () => {
    process.env.PYKEEN_ENABLED = "true";
    const { predictLinks } = await loadBridge();
    await expect(predictLinks({ triples: [], predict: { head: "a", relation: "r" } })).rejects.toThrow(
      /non-empty triples/,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects when predict does not fix exactly two slots, without spawning", async () => {
    process.env.PYKEEN_ENABLED = "true";
    const { predictLinks } = await loadBridge();
    // Only one slot fixed -> ambiguous which to predict.
    await expect(predictLinks({ ...INPUT, predict: { head: "drugA" } })).rejects.toThrow(/exactly two/);
    // All three fixed -> nothing to predict.
    await expect(
      predictLinks({ ...INPUT, predict: { head: "drugA", relation: "treats", tail: "diseaseX" } }),
    ).rejects.toThrow(/exactly two/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("predictLinks bridge", () => {
  const original = process.env.PYKEEN_ENABLED;
  beforeEach(() => {
    spawnMock.mockReset();
    process.env.PYKEEN_ENABLED = "true";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PYKEEN_ENABLED;
    else process.env.PYKEEN_ENABLED = original;
  });

  it("parses a well-formed { ok, model, epochs, target, predictions } into a typed result", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { predictLinks } = await loadBridge();

    const payload = JSON.stringify({
      ok: true,
      model: "TransE",
      epochs: 20,
      target: "tail",
      predictions: [
        { head: "drugA", relation: "treats", tail: "diseaseX", score: -1.2 },
        { head: "drugA", relation: "treats", tail: "diseaseZ", score: -3.4 },
      ],
    });
    emitRun(proc, payload, 0);

    const result = await predictLinks(INPUT);

    expect(result.ok).toBe(true);
    expect(result.model).toBe("TransE");
    expect(result.epochs).toBe(20);
    expect(result.target).toBe("tail");
    expect(result.predictions).toHaveLength(2);
    // Ranked high -> low; the predicted slot carries the candidate label.
    expect(result.predictions[0].tail).toBe("diseaseX");
    expect(result.predictions[0].score).toBeGreaterThan(result.predictions[1].score);
    expect(result.predictions[0].head).toBe("drugA");
    expect(result.predictions[0].relation).toBe("treats");
  });

  it("sends the request over stdin as JSON, not argv", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { predictLinks } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, model: "TransE", epochs: 20, target: "tail", predictions: [] }), 0);
    await predictLinks(INPUT);

    // Only the script path is passed as argv — no triples / prediction target leaks into argv.
    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv).toHaveLength(1);
    expect(argv[0]).toContain(["python", "pykeen", "run.py"].join(require("node:path").sep));

    const sent = JSON.parse(proc.stdin.written);
    expect(sent.triples).toEqual(INPUT.triples);
    expect(sent.predict).toEqual({ head: "drugA", relation: "treats", tail: undefined });
  });

  it("maps camelCase tuning options to the snake_case the script expects", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { predictLinks } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, model: "TransE", epochs: 5, target: "tail", predictions: [] }), 0);
    await predictLinks({ ...INPUT, model: "DistMult", epochs: 5, topK: 3, dimensions: 16, randomSeed: 7 });

    const sent = JSON.parse(proc.stdin.written);
    expect(sent.model).toBe("DistMult");
    expect(sent.epochs).toBe(5);
    expect(sent.top_k).toBe(3);
    expect(sent.dimensions).toBe(16);
    expect(sent.random_seed).toBe(7);
  });

  it("rejects when the engine reports { ok: false } (caller falls back)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { predictLinks } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: false, error: "ValueError: triple at index 0 has a null element" }), 1);
    await expect(predictLinks(INPUT)).rejects.toThrow(/null element/);
  });

  it("rejects on a non-zero exit with no stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { predictLinks } = await loadBridge();

    setImmediate(() => {
      proc.stderr.emit("data", "Traceback ...");
      proc.emit("close", 1);
    });
    await expect(predictLinks(INPUT)).rejects.toThrow(/pykeen exited 1/);
  });

  it("rejects on unparseable stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { predictLinks } = await loadBridge();

    emitRun(proc, "not json at all", 0);
    await expect(predictLinks(INPUT)).rejects.toThrow(/parse pykeen output/);
  });

  it("rejects (does not hang) when the subprocess exceeds the timeout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { predictLinks } = await loadBridge();

    // Never emit close: the timeout must fire and SIGKILL the child.
    await expect(predictLinks(INPUT, 20)).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects when the process fails to spawn (e.g. python3 missing)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { predictLinks } = await loadBridge();

    setImmediate(() => proc.emit("error", new Error("spawn python3 ENOENT")));
    await expect(predictLinks(INPUT)).rejects.toThrow(/ENOENT/);
  });
});
