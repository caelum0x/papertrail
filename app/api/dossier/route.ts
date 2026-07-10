import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { buildEvidenceDossier, type ClinicalTrialsResult } from "@/lib/dossier/build";
import { DossierRequestSchema } from "@/lib/dossier/schemas";
import { runEvidencePipeline } from "@/lib/evidencePipeline";
import { searchAndCache } from "@/lib/ingest/searchAndCache";

// Public POST endpoint for the EVIDENCE DOSSIER ORCHESTRATOR — PaperTrail's flagship.
//
// Given { subjectType: 'target'|'drug'|'disease'|'claim', subject, disease? }, it
// autonomously assembles a COMPLETE, verified, cited, TRUST-SCORED evidence dossier by
// composing the deterministic bio/evidence engines. Claude only PLANS which checks apply
// and NARRATES over the already-verified sections; every load-bearing number and the
// overall score/grade are DETERMINISTIC (see lib/dossier/build.ts).
//
// Mirrors app/api/bio/target-disease/route.ts: nodejs runtime, rate-limited, Zod-validated
// body, ok/fail envelope, and it NEVER logs the subject/disease text (only metadata).
//
// The efficacy pipeline (clinical_trials section) needs a Postgres pool; when the DB is
// unconfigured that section is simply omitted (honest omission) rather than failing the
// whole dossier — the other deterministic sections still run.
export const runtime = "nodejs";

// Postgres pool for the efficacy pipeline; undefined when the DB is unconfigured. The
// clinical_trials section degrades to an honest omission in that case.
function optionalPool() {
  try {
    return getPool();
  } catch {
    return undefined;
  }
}

// Adapter: wire the real runEvidencePipeline behind the dossier's `clinicalTrials`
// closure. It first ingests (cache-everything) so the pipeline has cached sources to
// retrieve, then pools. Returns null on any failure or when no pool is available — the
// section is then dropped rather than fabricated. Never re-fetches cached sources.
function clinicalTrialsAdapter(pool: ReturnType<typeof getPool> | undefined) {
  if (!pool) return undefined;
  return async (input: { claim: string; query?: string }): Promise<ClinicalTrialsResult | null> => {
    try {
      // Ingest first so retrieval has cached primary sources (best-effort; a failure
      // here still lets the pipeline run over whatever is already cached).
      await searchAndCache(pool, { query: input.query ?? input.claim }).catch(() => undefined);

      const pipeline = await runEvidencePipeline(pool, {
        claim: input.claim,
        query: input.query,
      });
      const report = pipeline.report;
      // On an insufficient report the pipeline reports how many studies were usable; on a
      // successful pool the usable count is the number of contributing sources.
      const usableStudies = report.ok ? pipeline.usedSources.length : report.usableStudies;
      return {
        usableStudies,
        usedSourceCount: pipeline.usedSources.length,
        poolable: report.ok === true,
        citations: pipeline.usedSources.slice(0, 10).map((s) => ({
          source: s.source_type,
          ref: s.id,
          detail: s.title,
        })),
        detail: pipeline,
      };
    } catch {
      return null;
    }
  };
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("dossier.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request. Surface the first validation
  // issue as a user-facing message rather than a raw Zod dump.
  const parsed = DossierRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid dossier request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  try {
    const { subjectType, subject, disease } = parsed.data;
    const pool = optionalPool();

    const dossier = await buildEvidenceDossier(
      { subjectType, subject, disease },
      { clinicalTrials: clinicalTrialsAdapter(pool) }
    );

    logEvent("dossier.success", {
      latencyMs: Date.now() - start,
      subjectType,
      sectionCount: dossier.sections.length,
      overallGrade: dossier.overallGrade,
      overallScore: dossier.overallScore,
      narrated: dossier.narrative !== null,
      // NOTE: subject/disease text is intentionally NOT logged.
    });

    return ok(dossier);
  } catch (err) {
    logEvent("dossier.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/dossier] failed:", err);
    return fail(
      "Something went wrong while assembling the evidence dossier. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
