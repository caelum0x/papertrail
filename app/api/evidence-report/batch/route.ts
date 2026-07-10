import { NextRequest, NextResponse } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  buildEvidenceReportBatch,
  evidenceReportBatchToCsv,
  BatchRequestSchema,
} from "@/lib/evidenceReportBatch";

// Public BATCH evidence-report endpoint. Runs the deterministic evidence-report
// chain across up to 50 claim+study items in one call and returns either the
// JSON envelope or, with ?format=csv, a downloadable spreadsheet. No LLM in the
// path; every number is reproducible from the input. Never logs claim text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("evidence_report_batch.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate the whole batch at the boundary — never trust the raw request.
  const parsed = BatchRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid batch request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const { items } = parsed.data;
  const wantsCsv = req.nextUrl.searchParams.get("format") === "csv";

  try {
    const results = buildEvidenceReportBatch(items);

    const errored = results.filter((r) => r.error !== null).length;
    logEvent("evidence_report_batch.success", {
      latencyMs: Date.now() - start,
      items: items.length,
      errored,
      format: wantsCsv ? "csv" : "json",
    });

    if (wantsCsv) {
      const csv = evidenceReportBatchToCsv(results);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="evidence-report-batch.csv"',
        },
      });
    }

    return ok(results, { total: results.length });
  } catch (err) {
    logEvent("evidence_report_batch.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/evidence-report/batch] failed:", err);
    return fail(
      "Something went wrong while building the batch evidence report. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
