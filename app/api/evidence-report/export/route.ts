import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  buildEvidenceReport,
  EvidenceReportRequestSchema,
} from "@/lib/evidenceReport";
import {
  evidenceReportToHtml,
  evidenceReportToText,
} from "@/lib/evidenceReportExport";

// Public EVIDENCE-REPORT EXPORT endpoint. Runs the same deterministic chain as
// /api/evidence-report (meta-analysis → publication-bias → GRADE → synthesis) and
// serializes the result as a self-contained GRADE Summary-of-Findings document a
// medical writer can paste into a dossier — HTML by default, plain text with
// ?format=text. No LLM anywhere in this path; never logs claim text or secrets.
export const runtime = "nodejs";

function contentDisposition(format: "html" | "text"): string {
  const ext = format === "text" ? "txt" : "html";
  return `attachment; filename="papertrail-summary-of-findings.${ext}"`;
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("evidence_report_export.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  const format: "html" | "text" =
    req.nextUrl.searchParams.get("format") === "text" ? "text" : "html";

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

  const { claim, studies, risk_of_bias_steps, indirectness_steps } = parsed.data;

  try {
    const report = buildEvidenceReport({
      claim,
      studies,
      riskOfBiasSteps: risk_of_bias_steps,
      indirectnessSteps: indirectness_steps,
    });

    const document =
      format === "text"
        ? evidenceReportToText(report, claim)
        : evidenceReportToHtml(report, claim);

    logEvent("evidence_report_export.success", {
      latencyMs: Date.now() - start,
      format,
      ok: report.ok,
      submitted: studies.length,
      // Only report-shape metadata — never the claim text itself.
      ...(report.ok
        ? { k: report.pooled.k, certainty: report.certainty.certainty }
        : { usable: report.usableStudies }),
    });

    return new NextResponse(document, {
      status: 200,
      headers: {
        "Content-Type":
          format === "text"
            ? "text/plain; charset=utf-8"
            : "text/html; charset=utf-8",
        "Content-Disposition": contentDisposition(format),
        // Deterministic artefact from the submitted inputs — safe to skip caching
        // rather than risk serving a stale export for edited inputs.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logEvent("evidence_report_export.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/evidence-report/export] failed:", err);
    return fail(
      "Something went wrong while exporting the evidence report. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
