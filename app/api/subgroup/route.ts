import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  subgroupAnalysis,
  verifyAgainstSubgroups,
  SubgroupRequestSchema,
  toEngineStudy,
  type Subgroup,
} from "@/lib/subgroupAnalysis";

// Public subgroup / effect-modification endpoint. Given a claim and >=1 named
// subgroups (each a set of study effect estimates), it pools each subgroup, runs
// the deterministic test for subgroup differences, and returns a verdict on whether
// the claim rests on a single subgroup rather than the overall trial effect.
// No LLM is anywhere in this path — every number is reproducible from the input.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("subgroup.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request. Surface the first
  // validation issue as a user-facing message rather than a raw Zod dump.
  const parsed = SubgroupRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(`Invalid subgroup request — ${where}${issue?.message ?? "check your inputs."}`, 400);
  }

  const { claim, subgroups } = parsed.data;

  try {
    const engineSubgroups: Subgroup[] = subgroups.map((sg) => ({
      name: sg.name,
      studies: sg.studies.map(toEngineStudy),
    }));

    // Numeric result (per-subgroup pools + between-groups test) and the claim-vs-
    // structure verdict. Both trace to the same standardized studies.
    const result = subgroupAnalysis(engineSubgroups);
    const verdict = verifyAgainstSubgroups(claim, engineSubgroups);

    logEvent("subgroup.success", {
      latencyMs: Date.now() - start,
      subgroups: result.subgroups.length,
      qBetween: result.qBetween,
      interactionSignificant: result.interactionSignificant,
      verdict: verdict.verdict,
    });

    return ok({
      // The per-subgroup pools and between-groups test.
      subgroups: result.subgroups.map((s) => ({
        name: s.name,
        measure: s.pooled.measure,
        k: s.pooled.k,
        point: s.pooled.random.point,
        ciLower: s.pooled.random.ciLower,
        ciUpper: s.pooled.random.ciUpper,
        reductionPercent: s.reductionPercent,
        significant: s.pooled.random.significant,
      })),
      qBetween: result.qBetween,
      df: result.df,
      pValue: result.pValue,
      interactionSignificant: result.interactionSignificant,
      overall: result.overall
        ? {
            measure: result.overall.measure,
            k: result.overall.k,
            point: result.overall.random.point,
            ciLower: result.overall.random.ciLower,
            ciUpper: result.overall.random.ciUpper,
            reductionPercent: result.overall.random.reductionPercent,
            significant: result.overall.random.significant,
          }
        : null,
      verdict: {
        verdict: verdict.verdict,
        rationale: verdict.rationale,
        claimedReductionPercent: verdict.claimedReductionPercent,
        overallReductionPercent: verdict.overallReductionPercent,
        matchedSubgroup: verdict.matchedSubgroup,
        matchedSubgroupReductionPercent: verdict.matchedSubgroupReductionPercent,
      },
    });
  } catch (err) {
    logEvent("subgroup.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/subgroup] failed:", err);
    return fail(
      "Something went wrong while analyzing these subgroups. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
