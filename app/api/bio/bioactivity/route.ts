import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { verifyBioactivityClaim } from "@/lib/bio/chembl";
import { BioactivityRequestSchema } from "@/lib/bio/chembl.schemas";

// Public POST endpoint for DRUG-TARGET BIOACTIVITY / MECHANISM verification over ChEMBL.
// Given { drug, target?, claimedPotencyNM?, claimedMechanism?, claimedPhase? } it
// resolves the drug to its ChEMBL id, fetches measured bioactivities (IC50/Ki/Kd/EC50),
// and returns a DETERMINISTIC verdict: potency confirmed_within_order / overstated /
// understated / not_found (order-of-magnitude band on nM), plus phase confirmed /
// overstated / understated / not_found (claimed vs ChEMBL max_phase), plus a mechanism
// consistency check — all with the supporting activity records.
//
// The verdicts are decided by documented numeric thresholds over the ChEMBL records —
// NO LLM in the loop, and nothing is fabricated: if the drug doesn't resolve or ChEMBL
// returns nothing, each arm degrades to an honest not_found rather than a guess.
//
// ATTRIBUTION: results carry a ChEMBL CC BY-SA 3.0 attribution string.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.bioactivity.rate_limited", { ip });
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
  const parsed = BioactivityRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid bioactivity request — ${where}${issue?.message ?? "provide a drug plus any of target/claimedPotencyNM/claimedMechanism/claimedPhase."}`,
      400
    );
  }

  try {
    const result = await verifyBioactivityClaim(parsed.data);
    logEvent("bio.bioactivity.success", {
      latencyMs: Date.now() - start,
      resolved: result.molecule.chemblId !== null,
      potencyVerdict: result.potency.verdict,
      phaseVerdict: result.phase.verdict,
      mechanismVerdict: result.mechanism.verdict,
      activityCount: result.supporting.length,
    });
    return ok(result);
  } catch (err) {
    logEvent("bio.bioactivity.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/bioactivity] failed:", err);
    return fail(
      "Something went wrong while verifying the drug-target bioactivity claim. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
