import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { dossierToStructured, dossierToText } from "@/lib/provenance/export";

// Public POST endpoint for the REGULATORY PROVENANCE + SUBMISSION-EXPORT layer.
// Given a computed dossier bundle { dossier }, it returns a submission-grade
// artifact: the structured JSON with every claim hash-chained (SHA-256) to its
// source, a recomputed chain-verified flag, the terminal root hash, and a
// deterministic evidence-quality score. `?format=text` returns the plain-text
// variant instead.
//
// Everything here is DETERMINISTIC — hashing and scoring are pure numeric
// operations with documented rules. NO LLM is in the provenance or numeric path.
// The route never logs claim text (only counts + the verified flag), mirroring
// app/api/bio/target-disease/route.ts: nodejs runtime, rate limit, Zod body,
// ok/fail envelope.
export const runtime = "nodejs";

// Dossier claim: the minimal source-backed unit. Bounds guard against oversized
// payloads; value accepts number or string (normalized downstream for hashing).
const DossierClaimSchema = z.object({
  statement: z.string().trim().min(1).max(2000),
  value: z.union([z.string().max(2000), z.number()]),
  source: z.string().trim().max(1000),
  quote: z.string().max(4000),
});

const DossierSectionSchema = z.object({
  title: z.string().trim().min(1).max(300),
  claims: z.array(DossierClaimSchema).max(500),
});

const DossierSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  generatedAt: z.string().max(64).optional(),
  sections: z.array(DossierSectionSchema).min(1).max(100),
});

const RequestSchema = z.object({
  dossier: DossierSchema,
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("dossier.export.rate_limited", { ip });
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
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid dossier export request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const wantText = new URL(req.url).searchParams.get("format") === "text";

  try {
    const { dossier } = parsed.data;

    // Deterministic export. dossierToText internally reuses dossierToStructured,
    // so both variants share one hash chain and quality score.
    if (wantText) {
      const text = dossierToText(dossier);
      const structured = dossierToStructured(dossier);
      logEvent("dossier.export.success", {
        latencyMs: Date.now() - start,
        format: "text",
        claimCount: structured.provenance.claimCount,
        verified: structured.provenance.verified,
        qualityScore: structured.provenance.qualityScore,
      });
      return ok({ format: "text", text, rootHash: structured.provenance.rootHash });
    }

    const structured = dossierToStructured(dossier);
    logEvent("dossier.export.success", {
      latencyMs: Date.now() - start,
      format: "structured",
      claimCount: structured.provenance.claimCount,
      verified: structured.provenance.verified,
      qualityScore: structured.provenance.qualityScore,
    });
    return ok(structured);
  } catch (err) {
    logEvent("dossier.export.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/dossier/export] failed:", err);
    return fail(
      "Something went wrong while exporting the dossier. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
