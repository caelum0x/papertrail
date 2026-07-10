import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { validateBiomarker, summarizeBiomarker } from "@/lib/bio/biomarker";
import { BiomarkerRequestSchema } from "@/lib/bio/biomarker.schemas";

// Public POST endpoint for BIOMARKER VALIDATION EVIDENCE. Given
// { biomarker, disease, drug? } (e.g. { "BRCA1", "breast cancer" } or
// { "CYP2C19*2", "clopidogrel resistance", drug: "clopidogrel" }) it DETERMINISTICALLY
// assembles the evidence for the claimed biomarker<->disease (or biomarker<->drug-
// response) relationship from four engines PaperTrail already built — genetic
// association (GWAS Catalog + ClinVar), target-disease genetic score (Open Targets),
// literature grounding (PubTator co-mention), and pharmacogenomic context (PharmGKB) —
// and returns a DETERMINISTIC validationLevel (analytically_grounded | emerging | weak
// | unsupported) with the assembled evidence and a rationale.
//
// NO LLM is in the decision path: the validationLevel is a pure function of the assembled
// component strengths. An optional `?summarize=true` adds a Claude-written plain-language
// summary that references only the assembled evidence (Zod-validated) — it never changes
// the level, and if it fails the bundle is still returned.
//
// On upstream failure each component degrades to an honest empty signal (never a
// fabricated value); the level is derived from what could be assembled.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.biomarker.rate_limited", { ip });
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
  const parsed = BiomarkerRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid biomarker request — ${where}${issue?.message ?? "provide { biomarker, disease }."}`,
      400
    );
  }

  // Opt-in Claude summary. Off by default so the endpoint costs zero tokens and
  // stays fully deterministic unless the caller explicitly asks for prose.
  const wantSummary = new URL(req.url).searchParams.get("summarize") === "true";

  try {
    const { biomarker, disease, drug } = parsed.data;

    // Deterministic bundle — the source of truth, assembled from real bio-data.
    const validation = await validateBiomarker({ biomarker, disease, drug });

    // Optional, strictly-additive prose layer. Isolated: a summary failure must
    // never discard the deterministic validation the caller came for.
    let summary = null;
    if (wantSummary) {
      try {
        summary = await summarizeBiomarker(validation);
      } catch (summaryErr) {
        logEvent("bio.biomarker.summary_error", { error: String(summaryErr) });
        summary = null;
      }
    }

    // Never log biomarker/disease/drug text — only non-identifying signal metadata.
    logEvent("bio.biomarker.success", {
      latencyMs: Date.now() - start,
      validationLevel: validation.validationLevel,
      geneticStrength: validation.evidence.genetic.strength,
      targetAssociationFound: validation.evidence.targetScore.associationFound,
      literatureStrength: validation.evidence.literature.strength,
      pgxAssessed: validation.evidence.pharmacogenomic.assessed,
      summarized: summary !== null,
    });

    return ok({
      ...validation,
      // Present only when requested AND produced; omitted otherwise so the shape
      // stays honest (no null-summary noise on the common deterministic path).
      ...(summary ? { summary } : {}),
    });
  } catch (err) {
    logEvent("bio.biomarker.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/biomarker] failed:", err);
    return fail(
      "Something went wrong while assembling the biomarker validation evidence. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
