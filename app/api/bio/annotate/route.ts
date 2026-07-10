import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { AnnotateRequestSchema } from "@/lib/bio/entities.schemas";
import { annotatePmids, annotateText, normalizeEntities } from "@/lib/bio/pubtator";

// Public POST endpoint for the biomedical ENTITY NORMALIZATION / grounding layer.
// Maps free text OR a batch of PMIDs to normalized bio-entities (genes, diseases,
// chemicals, variants, species) via NCBI PubTator Central. Every entity returned is
// something PubTator actually resolved — never fabricated. A PubTator failure or an
// unrecognized input degrades to an honest empty result, not a guessed entity.
//
// Body (exactly one of):
//   { "pmids": ["30763187", "..."] }   -> pre-computed annotations for indexed articles
//   { "text": "free text passage" }    -> on-the-fly annotation of arbitrary text
//
// Rate-limited, Zod-validated, {success,data,error} envelope. Free text is sanitized
// before it leaves the boundary and is NEVER logged.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio_annotate.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary: enforces exactly-one-of pmids/text, PMID format, and
  // the text length cap. Surface the first issue as a user-facing message.
  const parsed = AnnotateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid annotate request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  try {
    const body = parsed.data;

    if (body.pmids && body.pmids.length > 0) {
      const annotations = await annotatePmids(body.pmids);
      const documents = annotations.map((doc) => ({
        pmid: doc.pmid,
        entities: doc.entities,
        normalized: normalizeEntities(doc.entities),
      }));
      const totalEntities = documents.reduce((n, d) => n + d.entities.length, 0);

      // Never log the PMIDs themselves as content; counts only.
      logEvent("bio_annotate.pmids", {
        latencyMs: Date.now() - start,
        requested: body.pmids.length,
        resolved: documents.length,
        totalEntities,
      });

      return ok({ source: "pmids" as const, documents });
    }

    // Free-text path. Sanitize BEFORE it reaches the network, and never log it.
    const sanitized = sanitizeClaimText(body.text, {
      maxLength: 10_000,
      tooLongError: "Text is too long (max 10000 characters). Submit a shorter passage.",
    });
    if (!sanitized.ok) {
      return fail(sanitized.error, 400);
    }

    const annotations = await annotateText(sanitized.value);
    const documents = annotations.map((doc) => ({
      pmid: doc.pmid,
      entities: doc.entities,
      normalized: normalizeEntities(doc.entities),
    }));
    const totalEntities = documents.reduce((n, d) => n + d.entities.length, 0);

    logEvent("bio_annotate.text", {
      latencyMs: Date.now() - start,
      resolvedDocuments: documents.length,
      totalEntities,
    });

    return ok({ source: "text" as const, documents });
  } catch (err) {
    // Log the error class only — never the request text.
    logEvent("bio_annotate.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/annotate] failed:", err);
    return fail(
      "Something went wrong while annotating entities. This has been logged — please try again.",
      500
    );
  }
}
