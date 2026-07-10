import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { toEngineStudy, type Subgroup } from "@/lib/subgroupAnalysis";
import {
  checkSubgroupCitedAsPrimary,
  type SubgroupProvenance,
} from "@/lib/structuredVerification";

// Public POST endpoint for SUBGROUP-CITED-AS-PRIMARY verification. Given a claim
// and >=2 named subgroups (each a set of study effect estimates plus its
// provenance: pre-specified vs post-hoc, and an optional interaction p-value), it
// pools each subgroup, runs the deterministic test for subgroup differences, and
// flags `subgroup_cited_as_primary` when the claim quotes a subgroup effect —
// post-hoc and/or interaction-not-significant — as the trial's primary/whole-
// population result. No LLM is anywhere in this path; every number is reproducible
// from the input, and a subgroup that cannot be pooled is honestly reported rather
// than guessed. No claim or source text is ever logged.
export const runtime = "nodejs";

// One subgroup study: the engine's snake_case study shape (point+CI or 2x2 counts).
const StudySchema = z.object({
  label: z.string().min(1).max(200),
  measure: z.enum(["RR", "HR", "OR"]),
  point: z.number().positive().nullable().optional(),
  ci_lower: z.number().positive().nullable().optional(),
  ci_upper: z.number().positive().nullable().optional(),
  ci_pct: z.number().min(50).max(99.99).nullable().optional(),
  events1: z.number().int().min(0).nullable().optional(),
  total1: z.number().int().min(0).nullable().optional(),
  events2: z.number().int().min(0).nullable().optional(),
  total2: z.number().int().min(0).nullable().optional(),
});

// A subgroup plus its provenance. `prespecified` distinguishes a protocol/SAP
// pre-specified split from a post-hoc one; `interaction_p_value`, when reported,
// is the test-for-subgroup-differences p — otherwise the engine computes it.
const SubgroupSchema = z.object({
  name: z.string().min(1).max(200),
  prespecified: z.boolean(),
  interaction_p_value: z.number().min(0).max(1).nullable().optional(),
  studies: z.array(StudySchema).min(1).max(100),
});

const RequestSchema = z.object({
  claim: z.string().min(10).max(2000),
  subgroups: z.array(SubgroupSchema).min(1).max(20),
});

type SubgroupCheckRequest = z.infer<typeof RequestSchema>;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("verify.subgroup_check.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid subgroup-check request — ${where}${issue?.message ?? "provide a claim plus subgroups with provenance."}`,
      400
    );
  }

  const { claim, subgroups }: SubgroupCheckRequest = parsed.data;

  try {
    const engineSubgroups: Subgroup[] = subgroups.map((sg) => ({
      name: sg.name,
      studies: sg.studies.map((s) => toEngineStudy(s)),
    }));

    const provenance: SubgroupProvenance[] = subgroups.map((sg) => ({
      name: sg.name,
      prespecified: sg.prespecified,
      interactionPValue: sg.interaction_p_value ?? null,
    }));

    const result = checkSubgroupCitedAsPrimary(claim, engineSubgroups, provenance);

    logEvent("verify.subgroup_check.success", {
      latencyMs: Date.now() - start,
      subgroups: engineSubgroups.length,
      verdict: result.verdict,
      primacyFailures: result.primacyFailures.join(",") || "none",
      interactionSignificant: result.subgroupCheck.result?.interactionSignificant ?? null,
    });

    return ok({
      verdict: result.verdict,
      rationale: result.rationale,
      matchedSubgroup: result.matchedSubgroup,
      matchedSubgroupReductionPercent: result.matchedSubgroupReductionPercent,
      overallReductionPercent: result.overallReductionPercent,
      primacyFailures: result.primacyFailures,
      prespecified: result.prespecified,
      interactionPValue: result.interactionPValue,
      // The underlying deterministic subgroup structure, for the citation trail.
      subgroupAnalysis: {
        verdict: result.subgroupCheck.verdict,
        claimedReductionPercent: result.subgroupCheck.claimedReductionPercent,
        overallReductionPercent: result.subgroupCheck.overallReductionPercent,
        qBetween: result.subgroupCheck.result?.qBetween ?? null,
        df: result.subgroupCheck.result?.df ?? null,
        pValue: result.subgroupCheck.result?.pValue ?? null,
        interactionSignificant:
          result.subgroupCheck.result?.interactionSignificant ?? null,
        subgroups:
          result.subgroupCheck.result?.subgroups.map((s) => ({
            name: s.name,
            measure: s.pooled.measure,
            k: s.pooled.k,
            point: s.pooled.random.point,
            ciLower: s.pooled.random.ciLower,
            ciUpper: s.pooled.random.ciUpper,
            reductionPercent: s.reductionPercent,
            significant: s.pooled.random.significant,
          })) ?? [],
        overall: result.subgroupCheck.result?.overall
          ? {
              measure: result.subgroupCheck.result.overall.measure,
              k: result.subgroupCheck.result.overall.k,
              point: result.subgroupCheck.result.overall.random.point,
              ciLower: result.subgroupCheck.result.overall.random.ciLower,
              ciUpper: result.subgroupCheck.result.overall.random.ciUpper,
              reductionPercent:
                result.subgroupCheck.result.overall.random.reductionPercent,
              significant: result.subgroupCheck.result.overall.random.significant,
            }
          : null,
      },
    });
  } catch (err) {
    logEvent("verify.subgroup_check.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/verify/subgroup-check] failed:", err);
    return fail(
      "Something went wrong while running the subgroup-primacy check. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
