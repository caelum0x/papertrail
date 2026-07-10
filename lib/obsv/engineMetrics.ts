import {
  engineCallSchema,
  type EngineCall,
  type EngineSla,
  type EngineSlaSummary,
} from "@/lib/obsv/engineMetrics.schemas";

// In-process, per-engine rolling SLA recorder. Each evidence/bio engine gets a
// bounded ring buffer of its most-recent calls; engineSlaSummary() derives
// deterministic latency percentiles + error rate from those buffers. This is
// intentionally in-memory and dependency-free (no DB, no timers): it is a cheap
// operational signal for a status endpoint and an enterprise SLA, not durable
// analytics. Values reset on process restart / redeploy, which is the correct
// semantics for "recent health of this instance".

// Documented window: the last WINDOW_SIZE calls per engine are retained. Older
// calls are overwritten in FIFO order. Percentiles are computed over whatever is
// currently in the buffer (up to WINDOW_SIZE samples).
export const WINDOW_SIZE = 500;

// One engine's mutable ring buffer. Kept module-private; all reads go through
// engineSlaSummary() which returns fresh immutable snapshots.
interface EngineBuffer {
  // Fixed-capacity arrays; `count` samples are valid, `next` is the write cursor.
  latencies: number[];
  oks: boolean[];
  count: number;
  next: number;
}

// Module-level registry. Deterministic given the same ordered sequence of
// recordEngineCall() invocations from a fresh module state.
const buffers = new Map<string, EngineBuffer>();

function emptyBuffer(): EngineBuffer {
  return {
    latencies: new Array<number>(WINDOW_SIZE),
    oks: new Array<boolean>(WINDOW_SIZE),
    count: 0,
    next: 0,
  };
}

function getBuffer(engine: string): EngineBuffer {
  const existing = buffers.get(engine);
  if (existing) {
    return existing;
  }
  const created = emptyBuffer();
  buffers.set(engine, created);
  return created;
}

// Records one engine call. Input is validated (never trust an unbounded
// latency/engine name from a caller); invalid input is dropped rather than
// throwing, so metrics recording can never break the wrapped work.
export function recordEngineCall(call: EngineCall): void {
  const parsed = engineCallSchema.safeParse(call);
  if (!parsed.success) {
    return;
  }
  const { engine, latencyMs, ok } = parsed.data;
  const buf = getBuffer(engine);
  buf.latencies[buf.next] = latencyMs;
  buf.oks[buf.next] = ok;
  buf.next = (buf.next + 1) % WINDOW_SIZE;
  if (buf.count < WINDOW_SIZE) {
    buf.count += 1;
  }
}

// Nearest-rank percentile over an ascending-sorted, non-empty array. Deterministic:
// rank = ceil(p * n), clamped to [1, n], then index rank-1. p50 of an even-length
// set is the lower-middle element (nearest-rank, not interpolated) — this is the
// documented, testable definition used throughout this module.
function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) {
    return 0;
  }
  const rank = Math.ceil(p * n);
  const clamped = Math.min(Math.max(rank, 1), n);
  return sortedAsc[clamped - 1];
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function summarizeBuffer(engine: string, buf: EngineBuffer): EngineSla {
  const calls = buf.count;
  if (calls === 0) {
    return {
      engine,
      calls: 0,
      errors: 0,
      errorRate: 0,
      availability: 1,
      p50: 0,
      p95: 0,
      p99: 0,
      maxLatencyMs: 0,
      windowSize: WINDOW_SIZE,
    };
  }

  // Copy only the valid samples, then sort a fresh array (no mutation of the buffer).
  const latencies: number[] = [];
  let errors = 0;
  for (let i = 0; i < calls; i += 1) {
    latencies.push(buf.latencies[i]);
    if (!buf.oks[i]) {
      errors += 1;
    }
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const errorRate = round4(errors / calls);

  return {
    engine,
    calls,
    errors,
    errorRate,
    availability: round4(1 - errors / calls),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    maxLatencyMs: sorted[sorted.length - 1],
    windowSize: WINDOW_SIZE,
  };
}

// Deterministic snapshot of every engine's rolling SLA figures. Engines are
// sorted by name so the output is stable across calls. Returns immutable data;
// callers never touch the underlying buffers.
export function engineSlaSummary(): EngineSlaSummary {
  const engines = [...buffers.keys()].sort();
  return {
    generatedAt: new Date().toISOString(),
    windowSize: WINDOW_SIZE,
    engines: engines.map((engine) => summarizeBuffer(engine, getBuffer(engine))),
  };
}

// Clears all recorded metrics. Primarily for deterministic tests; also safe for
// operators to reset a window after a known incident.
export function resetEngineMetrics(): void {
  buffers.clear();
}

// Times and records a single engine call around `fn`. Records the latency and
// whether it resolved (ok=true) or threw (ok=false), then re-throws so callers
// see the original error — metrics are a side effect, never a behavior change.
export async function withEngineMetrics<T>(
  engine: string,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    recordEngineCall({ engine, latencyMs: Date.now() - started, ok: true });
    return result;
  } catch (err: unknown) {
    recordEngineCall({ engine, latencyMs: Date.now() - started, ok: false });
    throw err;
  }
}
