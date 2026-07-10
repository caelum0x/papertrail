import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import {
  linkEntities,
  isScispacyEnabled,
  type ScispacyResult,
} from "../lib/engines/scispacy";

// Bridge-only tests: no Python, no scispaCy, no model. We inject a fake `spawn` that
// emulates the subprocess contract (stdout JSON + close code) so we can prove the
// bridge parses a success payload, rejects on handled failure / non-zero exit / bad
// JSON, and always rejects (never throws) so the caller can fall back to the existing
// entity-normalization path. It must also feed the text as JSON on stdin (never argv).

/** A minimal fake ChildProcess: captures stdin, lets the test drive stdout/close/error. */
function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (c: string) => void; end: () => void };
    kill: (sig?: string) => void;
    stdinChunks: string[];
    killed: boolean;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdinChunks = [];
  proc.killed = false;
  proc.stdin = {
    write: (c: string) => proc.stdinChunks.push(c),
    end: () => {},
  };
  proc.kill = () => {
    proc.killed = true;
  };
  return proc;
}

function spawnReturning(driver: (proc: ReturnType<typeof makeFakeProc>) => void) {
  const proc = makeFakeProc();
  const spawnFn = (): import("node:child_process").ChildProcess => {
    // Drive the process on the next tick, after the bridge has attached listeners.
    setImmediate(() => driver(proc));
    return proc as unknown as import("node:child_process").ChildProcess;
  };
  return { proc, spawnFn };
}

const TEXT = "Aspirin reduced the risk of myocardial infarction.";

describe("isScispacyEnabled", () => {
  it("is opt-in via SCISPACY_ENABLED", () => {
    const prev = process.env.SCISPACY_ENABLED;
    process.env.SCISPACY_ENABLED = "true";
    expect(isScispacyEnabled()).toBe(true);
    process.env.SCISPACY_ENABLED = "false";
    expect(isScispacyEnabled()).toBe(false);
    delete process.env.SCISPACY_ENABLED;
    expect(isScispacyEnabled()).toBe(false);
    if (prev !== undefined) process.env.SCISPACY_ENABLED = prev;
  });
});

describe("linkEntities bridge", () => {
  it("parses a successful linking payload and forwards the text on stdin", async () => {
    const payload: ScispacyResult = {
      ok: true,
      entities: [
        {
          text: "Aspirin",
          label: "ENTITY",
          start: 0,
          end: 7,
          umlsCui: "C0004057",
          canonicalName: "aspirin",
          score: 0.98,
        },
        {
          text: "myocardial infarction",
          label: "ENTITY",
          start: 28,
          end: 49,
          umlsCui: null,
          canonicalName: null,
          score: null,
        },
      ],
    };
    const { proc, spawnFn } = spawnReturning((p) => {
      p.stdout.emit("data", JSON.stringify(payload));
      p.emit("close", 0);
    });

    const result = await linkEntities(TEXT, 5_000, spawnFn);
    expect(result.ok).toBe(true);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].umlsCui).toBe("C0004057");
    expect(result.entities[1].umlsCui).toBeNull();
    // The bridge must have piped the text as JSON to the child's stdin (never argv).
    expect(JSON.parse(proc.stdinChunks.join(""))).toEqual({ text: TEXT });
  });

  it("rejects (not throws) on empty text without spawning", async () => {
    let spawned = false;
    const spawnFn = (() => {
      spawned = true;
      return makeFakeProc() as unknown as import("node:child_process").ChildProcess;
    }) as unknown as Parameters<typeof linkEntities>[2];
    await expect(linkEntities("   ", 5_000, spawnFn)).rejects.toThrow(/text is required/);
    expect(spawned).toBe(false);
  });

  it("rejects (not throws) when the script reports a handled failure", async () => {
    const { spawnFn } = spawnReturning((p) => {
      p.stdout.emit("data", JSON.stringify({ ok: false, error: "OSError: model missing" }));
      p.emit("close", 1);
    });
    await expect(linkEntities(TEXT, 5_000, spawnFn)).rejects.toThrow(/OSError: model missing/);
  });

  it("rejects on a non-zero exit with no parseable payload", async () => {
    const { spawnFn } = spawnReturning((p) => {
      p.stderr.emit("data", "Traceback: boom");
      p.emit("close", 1);
    });
    await expect(linkEntities(TEXT, 5_000, spawnFn)).rejects.toThrow(/scispacy exited 1/);
  });

  it("rejects on unparseable stdout", async () => {
    const { spawnFn } = spawnReturning((p) => {
      p.stdout.emit("data", "not json");
      p.emit("close", 0);
    });
    await expect(linkEntities(TEXT, 5_000, spawnFn)).rejects.toThrow(/failed to parse/);
  });

  it("rejects and kills the process on timeout", async () => {
    const { proc, spawnFn } = spawnReturning(() => {
      /* never emit close — force the timeout path */
    });
    await expect(linkEntities(TEXT, 20, spawnFn)).rejects.toThrow(/timed out/);
    expect(proc.killed).toBe(true);
  });

  it("rejects when spawn itself errors (e.g. python3 missing)", async () => {
    const { spawnFn } = spawnReturning((p) => {
      p.emit("error", new Error("spawn python3 ENOENT"));
    });
    await expect(linkEntities(TEXT, 5_000, spawnFn)).rejects.toThrow(/ENOENT/);
  });
});
