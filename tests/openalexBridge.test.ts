import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Bridge test for the OpenAlex engine (lib/engines/openalex.ts). We mock
// node:child_process so nothing spawns Python or hits the network — this proves
// the trust boundary of the bridge: it parses a well-formed { ok, works } object,
// and it REJECTS (never throws to the route, never resolves garbage) on every
// failure mode so the caller can fall back to the existing TS + Claude retrieval.

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// A fake child process: EventEmitters for stdout/stderr/proc plus a stdin sink.
function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

// Drive one full run: emit stdout chunks, then close with an exit code.
function driveRun(proc: ReturnType<typeof makeFakeProc>, stdout: string, code: number) {
  if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
  proc.emit("close", code);
}

let searchOpenAlex: typeof import("../lib/engines/openalex").searchOpenAlex;
let isOpenAlexEnabled: typeof import("../lib/engines/openalex").isOpenAlexEnabled;

beforeEach(async () => {
  spawnMock.mockReset();
  vi.resetModules();
  const mod = await import("../lib/engines/openalex");
  searchOpenAlex = mod.searchOpenAlex;
  isOpenAlexEnabled = mod.isOpenAlexEnabled;
});

afterEach(() => {
  delete process.env.OPENALEX_ENABLED;
  delete process.env.OPENALEX_EMAIL;
});

describe("isOpenAlexEnabled", () => {
  it("is opt-in via OPENALEX_ENABLED === 'true'", () => {
    delete process.env.OPENALEX_ENABLED;
    expect(isOpenAlexEnabled()).toBe(false);
    process.env.OPENALEX_ENABLED = "1";
    expect(isOpenAlexEnabled()).toBe(false);
    process.env.OPENALEX_ENABLED = "true";
    expect(isOpenAlexEnabled()).toBe(true);
  });
});

describe("searchOpenAlex", () => {
  it("parses a well-formed { ok, works } payload from stdout", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const payload = {
      ok: true,
      works: [
        {
          openalex_id: "W123",
          title: "A trial",
          abstract: "reconstructed abstract text",
          doi: "https://doi.org/10.1/x",
          year: 2023,
          cited_by_count: 42,
          is_retracted: false,
        },
      ],
    };

    const promise = searchOpenAlex({ query: "drug x efficacy", limit: 5 });
    driveRun(proc, JSON.stringify(payload), 0);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.works).toHaveLength(1);
    expect(result.works[0].openalex_id).toBe("W123");
    expect(result.works[0].is_retracted).toBe(false);
  });

  it("passes the query via stdin, never on argv", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = searchOpenAlex({ query: "secret sensitive claim text" });
    driveRun(proc, JSON.stringify({ ok: true, works: [] }), 0);
    await promise;

    // argv is only [SCRIPT] — the query must not leak onto the command line.
    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv.join(" ")).not.toContain("secret sensitive claim text");
    const written = (proc.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(JSON.parse(written).query).toBe("secret sensitive claim text");
  });

  it("forwards OPENALEX_EMAIL to the child for the polite pool", async () => {
    process.env.OPENALEX_EMAIL = "demo@example.org";
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = searchOpenAlex({ query: "q" });
    driveRun(proc, JSON.stringify({ ok: true, works: [] }), 0);
    await promise;

    const written = (proc.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(JSON.parse(written).email).toBe("demo@example.org");
  });

  it("rejects (does not throw) when the script reports ok:false", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = searchOpenAlex({ query: "q" });
    driveRun(proc, JSON.stringify({ ok: false, error: "QueryError: bad filter" }), 1);

    await expect(promise).rejects.toThrow(/QueryError: bad filter/);
  });

  it("rejects on a non-zero exit with unparseable stdout, using stderr", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = searchOpenAlex({ query: "q" });
    proc.stderr.emit("data", Buffer.from("Traceback: ModuleNotFoundError pyalex"));
    proc.emit("close", 1);

    await expect(promise).rejects.toThrow(/openalex exited 1/);
  });

  it("rejects on malformed JSON stdout with a zero exit", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = searchOpenAlex({ query: "q" });
    driveRun(proc, "not json at all", 0);

    await expect(promise).rejects.toThrow(/failed to parse openalex output/);
  });

  it("rejects when ok:true but works is not an array", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = searchOpenAlex({ query: "q" });
    driveRun(proc, JSON.stringify({ ok: true, works: "nope" }), 0);

    await expect(promise).rejects.toThrow(/unexpected shape/);
  });

  it("rejects on spawn error (e.g. python3 missing) instead of throwing", async () => {
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = searchOpenAlex({ query: "q" });
    proc.emit("error", new Error("spawn python3 ENOENT"));

    await expect(promise).rejects.toThrow(/ENOENT/);
  });

  it("SIGKILLs and rejects when the child exceeds the timeout", async () => {
    vi.useFakeTimers();
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const promise = searchOpenAlex({ query: "q" }, 50);
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });

  it("rejects an empty query without spawning", async () => {
    await expect(searchOpenAlex({ query: "   " })).rejects.toThrow(/query is required/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
