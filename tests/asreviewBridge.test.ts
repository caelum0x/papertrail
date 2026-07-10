import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import {
  rankRecords,
  isAsreviewEnabled,
  type AsreviewInput,
} from "../lib/engines/asreview";

// Bridge-only tests: no Python, no ASReview. We inject a fake `spawn` that emulates the
// subprocess contract (stdout JSON + close code) so we can prove the bridge parses a
// success payload, rejects on handled failure / non-zero exit / bad JSON, and always
// rejects (never throws) so the caller can fall back to the TS + Claude path.

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

const INPUT: AsreviewInput = {
  records: [
    { id: "a", title: "T1", abstract: "A1" },
    { id: "b", title: "T2", abstract: "A2" },
    { id: "c", title: "T3", abstract: "A3" },
  ],
  labeled: [
    { id: "a", label: 1 },
    { id: "b", label: 0 },
  ],
};

describe("isAsreviewEnabled", () => {
  it("is opt-in via ASREVIEW_ENABLED", () => {
    const prev = process.env.ASREVIEW_ENABLED;
    process.env.ASREVIEW_ENABLED = "true";
    expect(isAsreviewEnabled()).toBe(true);
    process.env.ASREVIEW_ENABLED = "false";
    expect(isAsreviewEnabled()).toBe(false);
    delete process.env.ASREVIEW_ENABLED;
    expect(isAsreviewEnabled()).toBe(false);
    if (prev !== undefined) process.env.ASREVIEW_ENABLED = prev;
  });
});

describe("rankRecords bridge", () => {
  it("parses a successful ranking payload and forwards the job on stdin", async () => {
    const payload = {
      ok: true,
      ranking: [{ id: "c", relevance: 0.9 }],
    };
    const { proc, spawnFn } = spawnReturning((p) => {
      p.stdout.emit("data", JSON.stringify(payload));
      p.emit("close", 0);
    });

    const result = await rankRecords(INPUT, 5_000, spawnFn);
    expect(result.ok).toBe(true);
    expect(result.ranking).toEqual([{ id: "c", relevance: 0.9 }]);
    // The bridge must have piped the JSON job to the child's stdin.
    expect(JSON.parse(proc.stdinChunks.join(""))).toEqual(INPUT);
  });

  it("rejects (not throws) when the script reports a handled failure", async () => {
    const { spawnFn } = spawnReturning((p) => {
      p.stdout.emit("data", JSON.stringify({ ok: false, error: "ValueError: bad" }));
      p.emit("close", 1);
    });
    await expect(rankRecords(INPUT, 5_000, spawnFn)).rejects.toThrow(/ValueError: bad/);
  });

  it("rejects on a non-zero exit with no parseable payload", async () => {
    const { spawnFn } = spawnReturning((p) => {
      p.stderr.emit("data", "Traceback: boom");
      p.emit("close", 1);
    });
    await expect(rankRecords(INPUT, 5_000, spawnFn)).rejects.toThrow(/asreview exited 1/);
  });

  it("rejects on unparseable stdout", async () => {
    const { spawnFn } = spawnReturning((p) => {
      p.stdout.emit("data", "not json");
      p.emit("close", 0);
    });
    await expect(rankRecords(INPUT, 5_000, spawnFn)).rejects.toThrow(/failed to parse/);
  });

  it("rejects and kills the process on timeout", async () => {
    const { proc, spawnFn } = spawnReturning(() => {
      /* never emit close — force the timeout path */
    });
    await expect(rankRecords(INPUT, 20, spawnFn)).rejects.toThrow(/timed out/);
    expect(proc.killed).toBe(true);
  });

  it("rejects when spawn itself errors (e.g. python3 missing)", async () => {
    const { spawnFn } = spawnReturning((p) => {
      p.emit("error", new Error("spawn python3 ENOENT"));
    });
    await expect(rankRecords(INPUT, 5_000, spawnFn)).rejects.toThrow(/ENOENT/);
  });
});
