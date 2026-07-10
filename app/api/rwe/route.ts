import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { RweRequestSchema } from "@/lib/rwe/schemas";
import { defaultRweDeps, rweProfile } from "@/lib/rwe/signals";

// Public POST endpoint for DETERMINISTIC Real-World-Evidence (RWE) temporal
// signals over the OPEN corpus — the "Aetion angle" on public data.
//
// Body: { drug?, topic?, event? } (at least `topic`, and/or `drug`+`event`).
//   - drug + event -> per-year FAERS disproportionality trend (PRR/IC), classified
//                     rising/stable/falling by a deterministic OLS slope of yearly IC.
//   - topic        -> per-year PubMed publication + ClinicalTrials.gov trial-start
//                     counts, classified emerging/active/established by documented
//                     volume/recency thresholds.
//
// EVERY number is computed by the deterministic engine in lib/rwe/signals.ts
// (reusing the oracle-tested lib/bio/pharmacovigilance disproportionality math and
// lib/stats slope arithmetic). NO LLM is in the numeric path. On upstream failure
// each signal is returned as null (honest-empty), never fabricated.
//
// We never log the drug/event/topic text — only shape/latency metadata — so
// potentially unpublished research inputs don't leak into logs.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("rwe.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = RweRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid RWE request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  try {
    const profile = await rweProfile(parsed.data, defaultRweDeps());

    logEvent("rwe.success", {
      latencyMs: Date.now() - start,
      hasAdverseEventTrend: profile.adverseEventTrend !== null,
      hasEvidenceVolumeTrend: profile.evidenceVolumeTrend !== null,
      aeDirection: profile.adverseEventTrend?.direction ?? null,
      aeTotalReports: profile.adverseEventTrend?.totalReports ?? null,
      volMaturity: profile.evidenceVolumeTrend?.maturity ?? null,
    });

    return ok(profile);
  } catch (err) {
    logEvent("rwe.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/rwe] failed:", err);
    return fail(
      "Something went wrong while computing real-world-evidence signals. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
