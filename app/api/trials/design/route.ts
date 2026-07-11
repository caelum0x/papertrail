import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { parseEligibility, scoreDesignCredibility } from "@/lib/sources/trialDesign";
import { TrialDesignRequestSchema } from "@/lib/sources/trialDesign.schemas";

// Public POST endpoint for TRIAL DESIGN analysis. Given { eligibility?, design? } it
// returns (a) the eligibility blob split DETERMINISTICALLY into inclusion/exclusion
// gates, and (b) a DETERMINISTIC design-credibility prior (tier + priorWeight + the
// factors that moved the score) derived from the structured design fields. There is NO
// LLM anywhere in this path — the same input always yields the same gates and score,
// and nothing is fabricated: absent design fields deterministically lower the tier
// rather than being guessed. The prior weight is a supporting weight on design
// strength; it never decides a verdict by itself.
//
// Governance: we log only ids/counts (gate counts, tier, points) — never the
// eligibility text or any claim/source text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("trials.design.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = TrialDesignRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid trial-design request — ${where}${issue?.message ?? "provide eligibility text and/or a design object."}`,
      400
    );
  }

  try {
    const { eligibility, design } = parsed.data;

    const gates =
      eligibility !== undefined
        ? (() => {
            const g = parseEligibility(eligibility);
            return {
              inclusion: g.inclusion,
              exclusion: g.exclusion,
              inclusionCount: g.inclusion.length,
              exclusionCount: g.exclusion.length,
            };
          })()
        : null;

    const credibility = design !== undefined ? scoreDesignCredibility(design) : null;

    logEvent("trials.design.success", {
      latencyMs: Date.now() - start,
      inclusionCount: gates?.inclusionCount ?? 0,
      exclusionCount: gates?.exclusionCount ?? 0,
      tier: credibility?.tier ?? null,
      points: credibility?.points ?? null,
    });

    return ok({ gates, credibility });
  } catch (err) {
    logEvent("trials.design.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/trials/design] failed:", err);
    return fail(
      "Something went wrong while analyzing the trial design. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
