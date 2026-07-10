import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import {
  autoSynthesize,
  AutoSynthesizeInputSchema,
  type AutoSynthesisSource,
} from "@/lib/autoSynthesis";

// Public AUTO-SYNTHESIS endpoint. Given a claim and a set of cached source ids, it
// loads those sources from the `sources` table, DETERMINISTICALLY extracts each
// source's primary effect estimate (registered ratio for CT.gov, parsed ratio for
// PubMed), and pools them into a composite evidence report — instead of the caller
// hand-typing point estimates. No LLM is anywhere in this numeric path; every number
// is reproducible from the cached source data. Never logs claim text or secrets.
export const runtime = "nodejs";

// Body schema: a claim and the ids of cached sources to synthesise. The claim is
// re-validated/sanitised below (same hardening as /api/verify) before extraction.
const BodySchema = z.object({
  claim: z.string(),
  source_ids: z.array(z.string().uuid()).min(1).max(100),
});

interface SourceRow {
  id: string;
  source_type: string;
  title: string | null;
  raw_text: string;
  registered_results: unknown[] | null;
}

// Load the named cached sources, matching the PUBLIC access pattern the other source
// read endpoints use (lib/queries/sources.ts: direct, unscoped, parameterized reads
// of the `sources` table). Parameterized `= ANY($1)` — never string-interpolated ids.
async function loadSources(ids: readonly string[]): Promise<SourceRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<SourceRow>(
    `SELECT id, source_type, title, raw_text, registered_results
       FROM sources
      WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return rows;
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("auto_synthesis.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsedBody = BodySchema.safeParse(raw);
  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid auto-synthesis request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  // Harden the claim exactly like /api/verify (control chars, invisible/bidi smuggling,
  // length cap) BEFORE it touches the DB or the extraction engine. Never log its text.
  const sanitized = sanitizeClaimText(parsedBody.data.claim, {
    maxLength: 2000,
    tooLongError:
      "Claim is too long (max 2000 characters). Paste a single sentence or short passage.",
  });
  if (!sanitized.ok) {
    return fail(sanitized.error, 400);
  }
  const claim = sanitized.value;
  if (claim.length < 10) {
    return fail("Please provide a claim of at least 10 characters.", 400);
  }

  // De-duplicate ids so a repeated id can't double-count a single source in the pool.
  const sourceIds = Array.from(new Set(parsedBody.data.source_ids));

  try {
    const rows = await loadSources(sourceIds);

    if (rows.length === 0) {
      logEvent("auto_synthesis.no_sources", {
        latencyMs: Date.now() - start,
        requested: sourceIds.length,
      });
      return fail(
        "None of the requested source ids were found in the cache. Load or ingest the sources first.",
        404
      );
    }

    // Report which requested ids weren't found, so the caller can reconcile silently
    // dropped ids rather than wondering why the pool is smaller than expected.
    const foundIds = new Set(rows.map((r) => r.id));
    const missingIds = sourceIds.filter((id) => !foundIds.has(id));

    const sources: AutoSynthesisSource[] = rows.map((r) => ({
      id: r.id,
      source_type: r.source_type,
      title: r.title,
      raw_text: r.raw_text ?? "",
      registered_results: r.registered_results ?? null,
    }));

    // Validate the assembled input at the boundary before it reaches the pure engine.
    const input = AutoSynthesizeInputSchema.parse({ claim, sources });
    const result = autoSynthesize(input);

    logEvent("auto_synthesis.success", {
      latencyMs: Date.now() - start,
      requested: sourceIds.length,
      loaded: rows.length,
      missing: missingIds.length,
      extracted: result.studies.length,
      skipped: result.skipped.length,
      reportOk: result.report.ok,
      verdict: result.report.ok ? result.report.verdict.verdict : "insufficient",
    });

    return ok({
      report: result.report,
      studies: result.studies,
      skipped: result.skipped,
      missing_source_ids: missingIds,
    });
  } catch (err) {
    logEvent("auto_synthesis.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/auto-synthesis] failed:", err);
    return fail(
      "Something went wrong while auto-synthesising these sources. This has been logged — please try again.",
      500
    );
  }
}
