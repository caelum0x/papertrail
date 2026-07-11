import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  buildDebate,
  defaultDebateDeps,
  BuildDebateInputSchema,
} from "@/lib/synthesis/debate";

// Public POST endpoint for STRUCTURED DEBATE assembly on a MIXED-verdict claim — a native
// PaperTrail specialization of STORM. Given { claim, supporting:[{id,text}],
// refuting:[{id,text}] } it GROUNDS every evidence quote against the provided source text
// (dropping and counting the ungroundable), ranks each side by a DETERMINISTIC
// evidence-strength heuristic, and computes a synthesis STANCE from the grounded counts
// alone. No rank, count, quote, or stance is LLM-decided — Claude only writes the neutral
// connective prose between sections, and the debate is fully valid without it. Nothing is
// fabricated: an empty or fully-ungroundable side yields an honest one_sided/insufficient
// stance rather than a forced verdict. Never logs claim or source text — ids/counts only.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("synthesis.debate.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = BuildDebateInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid debate request — ${where}${issue?.message ?? "provide a claim plus supporting and refuting snippets."}`,
      400
    );
  }

  try {
    const result = await buildDebate(parsed.data, defaultDebateDeps);
    logEvent("synthesis.debate.success", {
      latencyMs: Date.now() - start,
      stance: result.sections.synthesis.stance,
      supportingCount: result.supportingCount,
      refutingCount: result.refutingCount,
      droppedUngrounded: result.droppedUngrounded,
    });
    return ok(result);
  } catch (err) {
    logEvent("synthesis.debate.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/synthesis/debate] failed:", err);
    return fail(
      "Something went wrong while assembling the debate. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
