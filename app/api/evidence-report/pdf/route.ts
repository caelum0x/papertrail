import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  buildEvidenceReport,
  EvidenceReportRequestSchema,
} from "@/lib/evidenceReport";
import { evidenceReportToPdf } from "@/lib/export/pdf";

// Public EVIDENCE-REPORT PDF EXPORT endpoint. Runs the same deterministic chain as
// /api/evidence-report (meta-analysis → publication-bias → GRADE → synthesis) and
// renders the result as a real PDF Summary-of-Findings via pdf-lib (no headless
// browser). No LLM in this path; never logs claim text or secrets.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("evidence_report_pdf.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

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

    const pdf = await evidenceReportToPdf(report, claim);

    logEvent("evidence_report_pdf.success", {
      latencyMs: Date.now() - start,
      ok: report.ok,
      submitted: studies.length,
      // Only report-shape metadata — never the claim text itself.
      ...(report.ok
        ? { k: report.pooled.k, certainty: report.certainty.certainty }
        : { usable: report.usableStudies }),
    });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="papertrail-summary-of-findings.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logEvent("evidence_report_pdf.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/evidence-report/pdf] failed:", err);
    return fail(
      "Something went wrong while exporting the PDF. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
