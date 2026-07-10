import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  buildEvidenceReport,
  EvidenceReportRequestSchema,
} from "@/lib/evidenceReport";

// Public composite EVIDENCE-REPORT endpoint. Given a claim and a set of trial
// effect estimates it chains the deterministic engines — meta-analysis →
// publication-bias → GRADE certainty → synthesis verdict — into one defensible
// object. No LLM is anywhere in this path; every number is reproducible from the
// input. Never logs claim text or secrets.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("evidence_report.rate_limited", { ip });
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
  const parsed = EvidenceReportRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid evidence-report request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const { claim, studies, risk_of_bias_steps, indirectness_steps, baselineRisk } =
    parsed.data;

  try {
    const report = buildEvidenceReport({
      claim,
      studies,
      riskOfBiasSteps: risk_of_bias_steps,
      indirectnessSteps: indirectness_steps,
      baselineRisk,
    });

    if (!report.ok) {
      logEvent("evidence_report.insufficient", {
        latencyMs: Date.now() - start,
        submitted: studies.length,
        usable: report.usableStudies,
      });
      return ok(report);
    }

    logEvent("evidence_report.success", {
      latencyMs: Date.now() - start,
      k: report.pooled.k,
      measure: report.pooled.measure,
      iSquared: report.pooled.heterogeneity.iSquared,
      certainty: report.certainty.certainty,
      biasVerdict: report.publicationBias.verdict,
      verdict: report.verdict.verdict,
      skipped: report.pooled.skipped.length,
    });

    return ok(report);
  } catch (err) {
    logEvent("evidence_report.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/evidence-report] failed:", err);
    return fail(
      "Something went wrong while building the evidence report. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
