import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bridge test for the pytrials engine (lib/engines/pytrials.ts). No Python, no
// network: we mock node:child_process.spawn with a fake child process so this runs
// in CI. It proves the bridge's contract — parse a well-formed { ok, count, studies }
// into a typed PyTrialsResult, and REJECT (never throw to the caller) on every failure
// mode so callers fall back. It also proves the request goes over stdin (not argv) so
// no query text leaks into the process table, and that the engine is opt-in
// (disabled -> reject without spawning).

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

/** Queue stdout data + a close code on the next tick, after searchTrials() attaches listeners. */
function emitRun(proc: ReturnType<typeof makeFakeChild>, stdoutData: string, code: number) {
  setImmediate(() => {
    if (stdoutData) proc.stdout.emit("data", stdoutData);
    proc.emit("close", code);
  });
}

async function loadBridge() {
  return import("../lib/engines/pytrials");
}

const INPUT = {
  query: "semaglutide cardiovascular outcomes",
  max: 5,
};

const STUDY = {
  nctId: "NCT01234567",
  title: "Semaglutide and Cardiovascular Outcomes",
  status: "COMPLETED",
  phase: "PHASE3",
  conditions: ["Type 2 Diabetes", "Cardiovascular Disease"],
  interventions: ["Semaglutide", "Placebo"],
  enrollment: 9641,
};

describe("isPyTrialsEnabled", () => {
  const original = process.env.PYTRIALS_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.PYTRIALS_ENABLED;
    else process.env.PYTRIALS_ENABLED = original;
  });

  it("is opt-in: only true when the env flag is exactly 'true'", async () => {
    const { isPyTrialsEnabled } = await loadBridge();
    process.env.PYTRIALS_ENABLED = "true";
    expect(isPyTrialsEnabled()).toBe(true);
    process.env.PYTRIALS_ENABLED = "1";
    expect(isPyTrialsEnabled()).toBe(false);
    delete process.env.PYTRIALS_ENABLED;
    expect(isPyTrialsEnabled()).toBe(false);
  });
});

describe("searchTrials disabled/fallback", () => {
  const original = process.env.PYTRIALS_ENABLED;
  beforeEach(() => spawnMock.mockReset());
  afterEach(() => {
    if (original === undefined) delete process.env.PYTRIALS_ENABLED;
    else process.env.PYTRIALS_ENABLED = original;
  });

  it("rejects without spawning when the engine is disabled (caller falls back)", async () => {
    delete process.env.PYTRIALS_ENABLED;
    const { searchTrials } = await loadBridge();
    await expect(searchTrials(INPUT)).rejects.toThrow(/disabled/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects on invalid input (empty query) without spawning", async () => {
    process.env.PYTRIALS_ENABLED = "true";
    const { searchTrials } = await loadBridge();
    await expect(searchTrials({ query: "   " })).rejects.toThrow(/required/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("searchTrials bridge", () => {
  const original = process.env.PYTRIALS_ENABLED;
  beforeEach(() => {
    spawnMock.mockReset();
    process.env.PYTRIALS_ENABLED = "true";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PYTRIALS_ENABLED;
    else process.env.PYTRIALS_ENABLED = original;
  });

  it("parses a well-formed { ok, count, studies } into a typed result", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { searchTrials } = await loadBridge();

    const payload = JSON.stringify({ ok: true, count: 1, studies: [STUDY] });
    emitRun(proc, payload, 0);

    const result = await searchTrials(INPUT);

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.studies).toHaveLength(1);
    expect(result.studies[0].nctId).toBe("NCT01234567");
    expect(result.studies[0].phase).toBe("PHASE3");
    expect(result.studies[0].conditions).toContain("Type 2 Diabetes");
    expect(result.studies[0].interventions).toContain("Semaglutide");
    expect(result.studies[0].enrollment).toBe(9641);
  });

  it("sends the request over stdin as JSON, not argv", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { searchTrials } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, count: 0, studies: [] }), 0);
    await searchTrials(INPUT);

    // Only the script path is passed as argv — no query text leaks into argv.
    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv).toHaveLength(1);
    expect(argv[0]).toContain(["python", "pytrials", "run.py"].join(require("node:path").sep));

    const sent = JSON.parse(proc.stdin.written);
    expect(sent.query).toBe(INPUT.query);
    expect(sent.max).toBe(INPUT.max);
  });

  it("passes optional fields and max through to the script payload", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { searchTrials } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: true, count: 0, studies: [] }), 0);
    await searchTrials({ query: "aspirin", fields: ["NCTId", "BriefTitle"], max: 42 });

    const sent = JSON.parse(proc.stdin.written);
    expect(sent.fields).toEqual(["NCTId", "BriefTitle"]);
    expect(sent.max).toBe(42);
  });

  it("rejects when the engine reports { ok: false } (caller falls back)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { searchTrials } = await loadBridge();

    emitRun(proc, JSON.stringify({ ok: false, error: "ValueError: 'max' must be between 1 and 1000" }), 1);
    await expect(searchTrials(INPUT)).rejects.toThrow(/must be between 1 and 1000/);
  });

  it("rejects on a non-zero exit with no stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { searchTrials } = await loadBridge();

    setImmediate(() => {
      proc.stderr.emit("data", "Traceback ...");
      proc.emit("close", 1);
    });
    await expect(searchTrials(INPUT)).rejects.toThrow(/pytrials exited 1/);
  });

  it("rejects on unparseable stdout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { searchTrials } = await loadBridge();

    emitRun(proc, "not json at all", 0);
    await expect(searchTrials(INPUT)).rejects.toThrow(/parse pytrials output/);
  });

  it("rejects (does not hang) when the subprocess exceeds the timeout", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { searchTrials } = await loadBridge();

    // Never emit close: the timeout must fire and SIGKILL the child.
    await expect(searchTrials(INPUT, 20)).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects when the process fails to spawn (e.g. python3 missing)", async () => {
    const proc = makeFakeChild();
    spawnMock.mockImplementation(() => proc);
    const { searchTrials } = await loadBridge();

    setImmediate(() => proc.emit("error", new Error("spawn python3 ENOENT")));
    await expect(searchTrials(INPUT)).rejects.toThrow(/ENOENT/);
  });
});
