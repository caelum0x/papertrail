import { NextRequest, NextResponse } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { assembleSubmissionBundle } from "@/lib/submission/bundle";
import { SubmissionBundleRequestSchema } from "@/lib/submission/schemas";

// POST /api/submission/bundle — assemble a regulator-facing SUBMISSION BUNDLE
// manifest for the caller's org from stored verifications and/or one evidence report.
//
// Body: { verificationIds?: uuid[], evidenceReportId?: uuid } (at least one required).
// Returns a deterministic CTD/eCTD-style manifest (summary-of-findings, methods,
// evidence table, provenance appendix, honest gaps). NO LLM is in this path — every
// number and span is copied verbatim from an engine result, and the bundle_hash is a
// reproducible seal over the manifest body.
//
// Editor+ only (this is an export/publish action). Rate-limited by IP. With
// ?format=json the manifest is returned as a downloadable attachment (still the same
// ok() envelope) so a reviewer can archive the exact bundle they previewed.
export const runtime = "nodejs";

export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  const start = Date.now();
  try {
    requireRole(ctx, "editor");

    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      logEvent("submission.bundle.rate_limited", { ip, orgId: ctx.org.id });
      return fail("Rate limit reached. Please try again shortly.", 429);
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return fail("Request body must be valid JSON.", 400);
    }

    const parsed = SubmissionBundleRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return fail(
        `Invalid submission-bundle request — ${where}${issue?.message ?? "provide verificationIds or an evidenceReportId."}`,
        400
      );
    }

    const manifest = await assembleSubmissionBundle(
      getPool(),
      ctx.org.id,
      parsed.data
    );

    logEvent("submission.bundle.assembled", {
      latencyMs: Date.now() - start,
      orgId: ctx.org.id,
      verificationsIncluded: manifest.counts.verifications_included,
      evidenceReportsIncluded: manifest.counts.evidence_reports_included,
      groundedSpans: manifest.counts.grounded_spans,
      gaps: manifest.counts.gaps,
      bundleHash: manifest.bundle_hash,
    });

    // ?format=json → same envelope, delivered as a downloadable attachment.
    const format = new URL(req.url).searchParams.get("format");
    if (format === "json") {
      const body = { success: true, data: manifest, error: null };
      const filename = `papertrail-submission-bundle-${manifest.bundle_hash.slice(0, 12)}.json`;
      return new NextResponse(JSON.stringify(body, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return ok(manifest);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    logEvent("submission.bundle.error", {
      latencyMs: Date.now() - start,
      orgId: ctx.org.id,
      error: err instanceof Error ? err.message : "unknown",
    });
    console.error("[/api/submission/bundle] failed:", err);
    return fail(
      "Something went wrong while assembling the submission bundle. This has been logged — please try again.",
      500
    );
  }
});
