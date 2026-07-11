import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  planIterativeRounds,
  MAX_ROUNDS,
  type RoundStats,
} from "@/lib/research/iterativeLoop";

// Public ITERATIVE DEEP-RESEARCH endpoint. Given the evidence accrued per research round
// — pooled study count, total participants, heterogeneity I², open contradictions — it
// returns a DETERMINISTIC per-round decision (continue with a concrete widen action, or
// stop) plus the final stop reason. It re-implements open_deep_research's supervisor loop
// as a state machine and reuses lib/evidencePipeline.ts `evidenceSufficiency`: NO LLM
// touches the continue/stop/widen decision — field-standard thresholds decide, and the
// loop is hard-capped at MAX_ROUNDS so it always terminates. An insufficient-at-cap run
// stops honestly rather than forcing a low-confidence conclusion.
//
// Mirrors app/api/bio/genetic-association/route.ts: nodejs runtime, IP checkRateLimit,
// zod safeParse, ok/fail envelope, try/catch, and NEVER logs claim/source text —
// ids/counts only.
export const runtime = "nodejs";

// One round's accrued evidence stats. `k` is the pooled study count (not sources
// retrieved). `iSquared` is null/omitted when heterogeneity could not be computed.
const RoundSchema = z.object({
  k: z.number().int().min(0),
  participants: z.number().int().min(0),
  iSquared: z.number().min(0).nullable().optional(),
  openContradictions: z.number().int().min(0).optional(),
});

const IterativeRequestSchema = z.object({
  rounds: z.array(RoundSchema).min(1).max(MAX_ROUNDS),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(`deep-research-iterative:${ip}`);
  if (!rate.allowed) {
    logEvent("deep_research.iterative.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = IterativeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid iterative-research request — ${where}${
        issue?.message ??
        `provide 1-${MAX_ROUNDS} rounds, each with k and participants counts.`
      }`,
      400
    );
  }

  try {
    // The zod-validated shape is structurally the RoundStats the loop expects.
    const rounds: RoundStats[] = parsed.data.rounds;
    const plan = planIterativeRounds(rounds);

    logEvent("deep_research.iterative.success", {
      latencyMs: Date.now() - start,
      roundsSupplied: plan.meta.roundsSupplied,
      roundsUsed: plan.final.roundsUsed,
      stopReason: plan.final.stopReason,
      sufficient: plan.final.sufficient,
    });
    return ok(plan);
  } catch (err) {
    logEvent("deep_research.iterative.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/deep-research/iterative] failed:", err);
    return fail(
      "Something went wrong while planning the iterative research loop. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
