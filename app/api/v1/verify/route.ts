import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { retrieveSources } from "@/lib/agents/retrievalAgent";
import { extractFinding } from "@/lib/agents/extractionAgent";
import { verifyClaim } from "@/lib/agents/verificationAgent";
import { reconcile } from "@/lib/effectSize";
import { parseSourceId } from "@/lib/sourceId";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { resolveOrgFromApiKey } from "@/lib/webhooks/apiKeyAuth";
import { dispatchEvent } from "@/lib/webhooks/dispatch";

export const runtime = "nodejs";

// Public API: POST /api/v1/verify
// Authenticated by an org API key in the `x-api-key` header (NOT a session), so
// external programmatic clients can run the verification pipeline. Rate-limited
// per key. On success, fires the `verification.completed` (and, when a
// discrepancy is found, `verification.flagged`) webhook events for the org.
// Returns the standard { success, data, error } envelope.

const verifyRequestSchema = z.object({
  claim: z
    .string()
    .trim()
    .min(10, "Please provide a claim of at least 10 characters.")
    .max(
      2000,
      "Claim is too long (max 2000 characters). Paste a single sentence or short passage."
    ),
  source_hint: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const pool = getPool();

    // 1. Authenticate by API key.
    const apiKey = req.headers.get("x-api-key");
    const auth = await resolveOrgFromApiKey(pool, apiKey);
    if (!auth) {
      return fail("Invalid or missing API key. Provide a valid x-api-key header.", 401);
    }

    // 2. Rate limit per key (bounds token spend per client).
    const rate = checkRateLimit(`v1:${auth.keyId}`);
    if (!rate.allowed) {
      logEvent("v1.verify.rate_limited", { orgId: auth.orgId });
      return fail("Rate limit reached. Please try again shortly.", 429);
    }

    // 3. Validate input.
    const json = await req.json().catch(() => null);
    const parsed = verifyRequestSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const { claim, source_hint } = parsed.data;
    const parsedHint = source_hint ? parseSourceId(source_hint) : null;

    // 4. Run the verification pipeline (same agents as the console pipeline).
    const sources = await retrieveSources(
      claim,
      parsedHint ? { preferExternalId: parsedHint.id } : undefined
    );

    if (sources.length === 0) {
      logEvent("v1.verify.no_source", {
        orgId: auth.orgId,
        latencyMs: Date.now() - start,
      });
      return ok({
        status: "no_support_found" as const,
        claim,
        message:
          "Couldn't find a confident matching primary source in PubMed or ClinicalTrials.gov. This doesn't mean the claim is false — it means this tool couldn't verify it against a source it could retrieve.",
      });
    }

    const source = sources[0];
    const corroboratingSources = sources.slice(1);

    const findings = await Promise.all(
      sources.map((s) => extractFinding(s.id, s.raw_text))
    );
    const finding = findings[0];
    const otherFindings = findings.slice(1);

    const verification = await verifyClaim({
      claim,
      finding,
      sourceRawText: source.raw_text,
      otherFindings,
    });

    const effectSizeCheck = reconcile(claim, source.raw_text);

    // 5. Persist (best-effort — a DB hiccup must not discard a paid-for result).
    let verificationId: string | null = null;
    try {
      const { rows } = await pool.query(
        `insert into verifications
           (claim_text, matched_source_id, discrepancy_type, trust_score, explanation,
            flagged_spans, cross_source_agreement, corroborating_source_ids)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
         returning id`,
        [
          claim,
          source.id,
          verification.discrepancy_type,
          verification.trust_score,
          verification.explanation,
          JSON.stringify(verification.flagged_spans),
          verification.cross_source_agreement,
          JSON.stringify(corroboratingSources.map((s) => s.id)),
        ]
      );
      verificationId = rows[0]?.id ?? null;
    } catch (persistErr) {
      logEvent("v1.verify.persist_error", {
        orgId: auth.orgId,
        error: String(persistErr),
      });
    }

    const responseData = {
      status: "verified" as const,
      verification_id: verificationId,
      claim,
      source: {
        title: source.title,
        url: source.url,
        source_type: source.source_type,
        external_id: source.external_id,
        raw_text: source.raw_text,
      },
      finding,
      verification,
      effect_size_check: effectSizeCheck,
    };

    // 6. Fire webhook events for the org. Fully isolated & best-effort; a slow
    // or failing receiver must never affect this response. We don't await it in
    // a way that can throw (dispatchEvent never throws), but we do await so the
    // serverless function isn't killed before deliveries are recorded.
    const isFlagged =
      verification.discrepancy_type !== "accurate" &&
      verification.discrepancy_type !== "no_support_found";
    try {
      await dispatchEvent(auth.orgId, "verification.completed", responseData);
      if (isFlagged) {
        await dispatchEvent(auth.orgId, "verification.flagged", responseData);
      }
    } catch (dispatchErr) {
      logEvent("v1.verify.dispatch_error", {
        orgId: auth.orgId,
        error: String(dispatchErr),
      });
    }

    logEvent("v1.verify.success", {
      orgId: auth.orgId,
      latencyMs: Date.now() - start,
      discrepancyType: verification.discrepancy_type,
      persisted: verificationId !== null,
    });

    return ok(responseData);
  } catch (err) {
    logEvent("v1.verify.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    return fail(
      "Something went wrong while verifying this claim. This has been logged — please try again, or try a different claim.",
      500
    );
  }
}
