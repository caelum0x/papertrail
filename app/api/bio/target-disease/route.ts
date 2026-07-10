import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { cachedBio } from "@/lib/bio/cache";
import { targetDiseaseEvidence, summarizeEvidence } from "@/lib/bio/openTargets";
import { TargetDiseaseRequestSchema } from "@/lib/bio/targets.schemas";

// Postgres pool for the bio cache; undefined (→ no caching, still works) if the DB
// is unconfigured. cachedBio degrades gracefully on any DB error either way.
function optionalPool() {
  try {
    return getPool();
  } catch {
    return undefined;
  }
}

// Public POST endpoint for TARGET–DISEASE EVIDENCE aggregation via the Open
// Targets Platform. Given { target, disease } (e.g. { "PCSK9", "hypercholesterolemia" })
// it resolves the Ensembl gene id + EFO disease id and returns the DETERMINISTIC
// association scores Open Targets computes — overall plus per-datatype (genetic,
// known-drug, literature, animal-model) — along with known drugs and tractability.
//
// The scores come straight from the API; NO LLM is in the numeric path. An optional
// `?summarize=true` adds a Claude-written plain-language summary that references
// only the returned data (Zod-validated) — it never changes a number, and if it
// fails the scores are still returned.
//
// On upstream failure the underlying engine returns an honest empty result
// (found: false, null scores) rather than a fabricated association.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.target_disease.rate_limited", { ip });
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
  const parsed = TargetDiseaseRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid target-disease request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  // Opt-in Claude summary. Off by default so the endpoint costs zero tokens and
  // stays fully deterministic unless the caller explicitly asks for prose.
  const wantSummary = new URL(req.url).searchParams.get("summarize") === "true";

  try {
    const { target, disease } = parsed.data;

    // Deterministic scores — the source of truth, straight from Open Targets,
    // memoized in Postgres so repeated lookups don't re-hit the rate-limited API.
    const evidence = await cachedBio(
      optionalPool(),
      "open_targets",
      `${target}|${disease}`.toLowerCase(),
      () => targetDiseaseEvidence(target, disease)
    );

    // Optional, strictly-additive prose layer. Isolated: a summary failure must
    // never discard the numbers the caller came for.
    let summary = null;
    if (wantSummary && evidence.found) {
      try {
        summary = await summarizeEvidence(evidence);
      } catch (summaryErr) {
        logEvent("bio.target_disease.summary_error", { error: String(summaryErr) });
        summary = null;
      }
    }

    logEvent("bio.target_disease.success", {
      latencyMs: Date.now() - start,
      found: evidence.found,
      targetResolved: evidence.target.ensemblId !== null,
      diseaseResolved: evidence.disease.efoId !== null,
      overallScore: evidence.overallScore,
      knownDrugCount: evidence.knownDrugs.length,
      summarized: summary !== null,
    });

    return ok({
      ...evidence,
      // Present only when requested AND produced; omitted otherwise so the shape
      // stays honest (no null-summary noise on the common deterministic path).
      ...(summary ? { summary } : {}),
    });
  } catch (err) {
    logEvent("bio.target_disease.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/target-disease] failed:", err);
    return fail(
      "Something went wrong while aggregating target–disease evidence. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
