import { ok, fail } from "@/lib/api/response";
import { engineSlaSummary } from "@/lib/obsv/engineMetrics";

export const runtime = "nodejs";

// GET /api/observability/engines — per-engine SLA summary (rolling latency
// percentiles + error rate/availability) for the current process. Public and
// cheap: it reads only in-memory counters and exposes no secrets, no claim text,
// no source content — just engine names and aggregate health numbers, so an
// external SLA monitor / status page can poll it without auth.
export async function GET(): Promise<Response> {
  try {
    const summary = engineSlaSummary();
    return ok(summary);
  } catch {
    return fail("Failed to build engine SLA summary.", 500);
  }
}
