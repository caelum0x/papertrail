import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { orchestrate } from "@/lib/moa/orchestrate";

// Public POST endpoint for the MIXTURE-OF-AGENTS verifier. Given { claim, sources[], options? }
// it routes the claim through all 17 backend engines as gated experts, mixes their
// contributions into one deterministic verdict + trust score, and (optionally) writes a
// grounded narrative. Claude touches only the advisory routing planner and the explanatory
// narrative — never the numeric verdict/scoring mix (the moat).
//
// Never logs claim or source text — ids/counts/verdict only.
export const runtime = "nodejs";
export const maxDuration = 60;

const SourceSchema = z.object({
  id: z.string().min(1, "each source needs a non-empty id."),
  text: z.string().min(1, "each source needs non-empty text.").max(20000),
  title: z.string().max(500).optional(),
  url: z.string().max(1000).optional(),
  journal: z.string().max(300).optional(),
  year: z.number().int().min(1800).max(2100).optional(),
  citations: z.number().int().min(0).optional(),
  isPreprint: z.boolean().optional(),
  isOpenAccess: z.boolean().optional(),
  retracted: z.boolean().optional(),
  doi: z.string().max(200).optional(),
  label: z.enum(["SUPPORTS", "REFUTES", "NEI"]).optional(),
  labelConfidence: z.number().min(0).max(1).optional(),
});

const OrchestrateRequestSchema = z.object({
  claim: z.string().trim().min(3, "claim must be at least 3 characters.").max(2000),
  sources: z
    .array(SourceSchema)
    .min(1, "provide at least one source.")
    .max(40, "too many sources — send at most 40."),
  options: z
    .object({
      llm: z.boolean().optional(),
      maxExperts: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("moa.orchestrate.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = OrchestrateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid request — ${where}${issue?.message ?? "provide a claim plus sources[{id, text}]."}`,
      400
    );
  }

  try {
    const { claim, sources, options } = parsed.data;
    const result = await orchestrate({ claim, sources, options });

    logEvent("moa.orchestrate.success", {
      latencyMs: Date.now() - start,
      sourceCount: sources.length,
      selected: result.agents.length,
      verdict: result.aggregate.verdict,
      trust: result.aggregate.trust,
      usedClaude: result.usedClaude,
    });

    return ok(result);
  } catch (err) {
    logEvent("moa.orchestrate.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/moa/orchestrate] failed:", err);
    return fail(
      "Something went wrong while running the mixture of agents. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
