import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// Bridge test for the STORM synthesis engine (lib/engines/storm.ts). We mock
// node:child_process.spawn with a scriptable fake process so no real Python runs.
// This exercises the bridge's parse / resolve / reject-and-fall-back contract:
//   - valid { ok: true, ... } stdout on exit 0            -> resolves typed result
//   - { ok: false, error } or malformed stdout            -> REJECTS (caller falls back)
//   - non-zero exit / spawn error / timeout               -> REJECTS
// The bridge must never throw synchronously to the route; every failure is a rejected
// promise so the caller can choose the existing TS+Claude synthesis path.

interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

// The scenario the next spawn() call should play out.
let scenario: (proc: FakeProc) => void;

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeProc["stdin"];
  stdin.write = vi.fn();
  stdin.end = vi.fn();
  proc.stdin = stdin;
  proc.kill = vi.fn();
  return proc;
}

const spawnMock = vi.fn((_bin: string, _argv: string[]): FakeProc => {
  const proc = makeFakeProc();
  // Defer the scripted events so listeners are attached first (matches real async spawn).
  queueMicrotask(() => scenario(proc));
  return proc;
});

vi.mock("node:child_process", () => ({
  spawn: (bin: string, argv: string[]) => spawnMock(bin, argv),
}));

import { generateStormArticle, isStormEnabled, type StormResult } from "@/lib/engines/storm";

function emitStdoutThenClose(proc: FakeProc, payload: string, code = 0): void {
  proc.stdout.emit("data", payload);
  proc.emit("close", code);
}

beforeEach(() => {
  spawnMock.mockClear();
  delete process.env.STORM_ENABLED;
});

describe("isStormEnabled", () => {
  it("is opt-in: false unless STORM_ENABLED === 'true'", () => {
    expect(isStormEnabled()).toBe(false);
    process.env.STORM_ENABLED = "1";
    expect(isStormEnabled()).toBe(false);
    process.env.STORM_ENABLED = "true";
    expect(isStormEnabled()).toBe(true);
  });
});

describe("generateStormArticle — success", () => {
  it("parses a valid { ok: true } payload into a typed result", async () => {
    const payload: StormResult = {
      ok: true,
      outline: ["Overview", "Efficacy", "Efficacy > Primary endpoint"],
      article: "The trial reported a 30% relative risk reduction [1].",
      citations: [{ title: "Landmark RCT", url: "https://pubmed.ncbi.nlm.nih.gov/1" }],
    };
    scenario = (proc) => emitStdoutThenClose(proc, JSON.stringify(payload), 0);

    const result = await generateStormArticle({ topic: "Drug X efficacy", sources: [] });

    expect(result.article).toContain("30% relative risk reduction");
    expect(result.outline).toHaveLength(3);
    expect(result.citations[0]).toEqual({ title: "Landmark RCT", url: "https://pubmed.ncbi.nlm.nih.gov/1" });
  });

  it("passes topic + sources to the child over stdin, not argv", async () => {
    const payload: StormResult = { ok: true, outline: [], article: "x", citations: [] };
    scenario = (proc) => {
      // Assert stdin received the JSON request before we complete the process.
      const written = proc.stdin.write.mock.calls[0]?.[0] as string;
      expect(written).toContain('"topic":"Sensitive topic"');
      expect(written).toContain('"sources"');
      emitStdoutThenClose(proc, JSON.stringify(payload), 0);
    };

    await generateStormArticle({ topic: "Sensitive topic", sources: [{ title: "S", text: "body" }] });

    // Only the script path is an argv element; no claim/source text in argv.
    const argv = spawnMock.mock.calls[0]![1];
    expect(argv.every((a) => !a.includes("Sensitive topic"))).toBe(true);
  });
});

describe("generateStormArticle — fallback (rejects, never throws to caller)", () => {
  it("rejects when the engine reports { ok: false }", async () => {
    scenario = (proc) =>
      emitStdoutThenClose(proc, JSON.stringify({ ok: false, error: "RuntimeError: no key" }), 0);
    await expect(generateStormArticle({ topic: "t" })).rejects.toThrow("RuntimeError: no key");
  });

  it("rejects on malformed (non-JSON) stdout", async () => {
    scenario = (proc) => emitStdoutThenClose(proc, "not json at all", 0);
    await expect(generateStormArticle({ topic: "t" })).rejects.toThrow("failed to parse storm output");
  });

  it("rejects when required fields are missing (ok but no outline array)", async () => {
    scenario = (proc) =>
      emitStdoutThenClose(proc, JSON.stringify({ ok: true, article: "x", citations: [] }), 0);
    await expect(generateStormArticle({ topic: "t" })).rejects.toThrow("no outline array");
  });

  it("rejects on a non-zero exit code and surfaces trimmed stderr", async () => {
    scenario = (proc) => {
      proc.stderr.emit("data", "ModuleNotFoundError: knowledge_storm");
      proc.emit("close", 1);
    };
    await expect(generateStormArticle({ topic: "t" })).rejects.toThrow(/storm exited 1/);
  });

  it("rejects when the child process fails to spawn", async () => {
    scenario = (proc) => proc.emit("error", new Error("spawn python3 ENOENT"));
    await expect(generateStormArticle({ topic: "t" })).rejects.toThrow("ENOENT");
  });

  it("rejects and SIGKILLs on timeout", async () => {
    vi.useFakeTimers();
    let killed: FakeProc | null = null;
    scenario = (proc) => {
      killed = proc;
      // never emit close -> force the timeout path
    };
    const p = generateStormArticle({ topic: "t" }, 50);
    const assertion = expect(p).rejects.toThrow("storm synthesis timed out");
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    expect(killed!.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });
});
