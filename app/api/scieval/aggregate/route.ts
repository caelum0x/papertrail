import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { ScievalLabel } from "@/lib/scieval/schemas";
import { aggregateCrossSource } from "@/lib/scieval/crossSourceAggregate";

// Public POST endpoint for CROSS-SOURCE label AGGREGATION — the native TS step MultiVerS
// never ships. Given per-source single-abstract labels { sources: [{ id, label, confidence? }] }
// over the MultiVerS taxonomy (SUPPORTS / REFUTES / NEI), it returns ONE DETERMINISTIC
// aggregate verdict for the claim: supported / refuted / mixed / insufficient, with the
// confidence-weighted tally and net direction. No LLM in this path — the verdict is a rule
// over a confidence-weighted tally (mirrors backend/engines/multivers/papertrail_aggregate.py);
// Claude only assigned the per-abstract labels upstream. An all-NEI or empty body of evidence
// yields an honest "insufficient" rather than a forced directional verdict. Never logs source
// ids or label text as content — only counts/verdict metadata.
export const runtime = "nodejs";

// Request schema. Reuses the MultiVerS label vocab from lib/scieval/schemas.ts (ScievalLabel);
// we do NOT redefine the taxonomy here. `id` is an opaque source identifier; `confidence` is
// optional (defaults to a full-strength vote in aggregateCrossSource).
const AggregateRequestSchema = z.object({
  sources: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(200),
        label: ScievalLabel,
        confidence: z.number().min(0).max(1).optional(),
      })
    )
    .min(1)
    .max(200),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("scieval.aggregate.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = AggregateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid aggregate request — ${where}${issue?.message ?? "provide sources with a label each."}`,
      400
    );
  }

  try {
    const result = aggregateCrossSource(parsed.data.sources);

    logEvent("scieval.aggregate.success", {
      latencyMs: Date.now() - start,
      verdict: result.verdict,
      supportCount: result.supportCount,
      refuteCount: result.refuteCount,
      neiCount: result.neiCount,
      mixed: result.mixed,
      consideredCount: result.consideredCount,
    });

    return ok(result);
  } catch (err) {
    logEvent("scieval.aggregate.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/scieval/aggregate] failed:", err);
    return fail(
      "Something went wrong while aggregating the cross-source labels. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
