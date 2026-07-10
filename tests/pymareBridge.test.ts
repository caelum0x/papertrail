import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Bridge-level test for the PyMARE cross-check subprocess (lib/engines/pymare.ts).
// No real Python here: we mock node:child_process so we can assert the bridge's
// contract in isolation — it parses a valid {ok:true} payload, REJECTS (never
// throws) on a handled {ok:false} error so the caller can fall back to the TS
// oracle, rejects on a malformed result shape, and honors the env opt-in flag.

// A fake ChildProcess whose stdout/stderr are EventEmitters and whose stdin
// captures what the bridge writes. Lets a test script drive close/error events.
function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { pooledPyMARE, isPyMareEnabled } = await import("../lib/engines/pymare");

// Emit a run.py-style stdout payload then close with the given exit code.
function driveClose(proc: ReturnType<typeof makeFakeProc>, stdout: string, code = 0, stderr = "") {
  if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
  if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
  proc.emit("close", code);
}

const OK_PAYLOAD = JSON.stringify({
  ok: true,
  fixed: { estimate: -0.35, se: 0.1, ciLower: -0.55, ciUpper: -0.15 },
  random: { estimate: -0.34, se: 0.13, ciLower: -0.6, ciUpper: -0.08, tau2: 0.02 },
  q: 5.2,
  i2: 42.3,
});

describe("isPyMareEnabled", () => {
  const original = process.env.PYMARE_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.PYMARE_ENABLED;
    else process.env.PYMARE_ENABLED = original;
  });

  it("is opt-in: only true when PYMARE_ENABLED === 'true'", () => {
    process.env.PYMARE_ENABLED = "true";
    expect(isPyMareEnabled()).toBe(true);
    process.env.PYMARE_ENABLED = "1";
    expect(isPyMareEnabled()).toBe(false);
    delete process.env.PYMARE_ENABLED;
    expect(isPyMareEnabled()).toBe(false);
  });
});

describe("pooledPyMARE bridge", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("parses a valid ok payload into a typed result and feeds input on stdin", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = pooledPyMARE({ yi: [-0.4, -0.3], vi: [0.01, 0.02] });
    driveClose(proc, OK_PAYLOAD, 0);
    const result = await promise;

    expect(result.fixed.estimate).toBeCloseTo(-0.35, 6);
    expect(result.random.tau2).toBeCloseTo(0.02, 6);
    expect(result.i2).toBeCloseTo(42.3, 6);
    // The payload is written to stdin (not argv) and stdin is closed.
    expect(proc.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ yi: [-0.4, -0.3], vi: [0.01, 0.02] }),
    );
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it("rejects (does not throw) on a handled {ok:false} error so the caller can fall back", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = pooledPyMARE({ yi: [-0.4, -0.3], vi: [0.01, 0.02] });
    // run.py surfaces handled errors as JSON on stdout with a non-zero exit.
    driveClose(proc, JSON.stringify({ ok: false, error: "ValueError: all vi must be > 0" }), 1);

    await expect(promise).rejects.toThrow(/all vi must be > 0/);
  });

  it("rejects on a malformed result shape", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = pooledPyMARE({ yi: [-0.4, -0.3], vi: [0.01, 0.02] });
    // Missing random/q/i2 — the bridge must not resolve a partial result.
    driveClose(proc, JSON.stringify({ ok: true, fixed: { estimate: 1 } }), 0);

    await expect(promise).rejects.toThrow(/unexpected result shape|estimate/i);
  });

  it("rejects on unparseable stdout with a non-zero exit (Python crashed)", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = pooledPyMARE({ yi: [-0.4, -0.3], vi: [0.01, 0.02] });
    driveClose(proc, "", 1, "Traceback: ModuleNotFoundError: No module named 'pymare'");

    await expect(promise).rejects.toThrow(/pymare exited 1/);
  });

  it("rejects when the subprocess emits an error (e.g. python3 not found)", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = pooledPyMARE({ yi: [-0.4, -0.3], vi: [0.01, 0.02] });
    proc.emit("error", new Error("spawn python3 ENOENT"));

    await expect(promise).rejects.toThrow(/ENOENT/);
  });

  it("kills the subprocess and rejects on timeout", async () => {
    vi.useFakeTimers();
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = pooledPyMARE({ yi: [-0.4, -0.3], vi: [0.01, 0.02] }, 50);
    vi.advanceTimersByTime(51);

    await expect(promise).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });
});
