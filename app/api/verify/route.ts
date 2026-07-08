import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { retrieveSources } from "@/lib/agents/retrievalAgent";
import { extractFinding } from "@/lib/agents/extractionAgent";
import { verifyClaim } from "@/lib/agents/verificationAgent";
import { checkRateLimit } from "@/lib/rateLimit";
import { reconcile } from "@/lib/effectSize";
import { checkAgainstRegistry } from "@/lib/structuredVerification";
import { TrialResultAnalysis } from "@/lib/sources/clinicaltrials";
import { parseSourceId } from "@/lib/sourceId";
import { getMockVerifyResponse } from "@/lib/mockData";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

// Offline demo/dev mode: answer the locked demo claims from hand-verified fixtures
// (real grounding + effect-size, stubbed network/LLM). Lets the app run and demo with
// zero secrets and keeps the live demo off the network critical path.
const MOCK_MODE = process.env.MOCK_MODE === "true";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("verify.rate_limited", { ip });
    return NextResponse.json(
      { error: "Rate limit reached. Please try again shortly." },
      { status: 429 }
    );
  }

  let body: { claim?: string; source_hint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const claim = body.claim?.trim();
  if (!claim || claim.length < 10) {
    return NextResponse.json(
      { error: "Please provide a claim of at least 10 characters." },
      { status: 400 }
    );
  }
  if (claim.length > 2000) {
    return NextResponse.json(
      { error: "Claim is too long (max 2000 characters). Paste a single sentence or short passage." },
      { status: 400 }
    );
  }

  // Optional "pin to cited source": a DOI / PMID / NCT the user actually cited.
  const parsedHint = body.source_hint ? parseSourceId(body.source_hint) : null;

  if (MOCK_MODE) {
    const mock = getMockVerifyResponse(claim);
    logEvent("verify.mock", { latencyMs: Date.now() - start, matched: mock?.status ?? "none" });
    return NextResponse.json(
      mock ?? {
        status: "no_support_found",
        message:
          "Offline demo mode: this claim isn't one of the pre-loaded demo examples. Try one of the 'Try' examples.",
      }
    );
  }

  try {
    // Multi-source cross-verification: retrieve the top confident matches, not just one.
    const sources = await retrieveSources(
      claim,
      parsedHint ? { preferExternalId: parsedHint.id } : undefined
    );

    if (sources.length === 0) {
      logEvent("verify.no_source", { latencyMs: Date.now() - start });
      return NextResponse.json({
        status: "no_support_found",
        message:
          "Couldn't find a confident matching primary source in PubMed or ClinicalTrials.gov. This doesn't mean the claim is false — it means this tool couldn't verify it against a source it could retrieve.",
      });
    }

    const source = sources[0];
    const corroboratingSources = sources.slice(1);

    // Extract a structured finding from EVERY retrieved source (each is DB-cached),
    // so verification can judge cross-source agreement — not just the best match.
    const findings = await Promise.all(sources.map((s) => extractFinding(s.id, s.raw_text)));
    const finding = findings[0];
    const otherFindings = findings.slice(1);

    const verification = await verifyClaim({
      claim,
      finding,
      sourceRawText: source.raw_text,
      otherFindings,
    });

    // Deterministic, rule-based numeric cross-check that runs alongside the LLM
    // verdict — it fires only on decidable cases (magnitude overstated / dropped
    // null-crossing caveat) and otherwise defers. Surfaced as an independent signal;
    // it never overrides the model's discrepancy_type.
    const effectSizeCheck = reconcile(claim, source.raw_text);

    // The differentiator: for ClinicalTrials.gov sources, verify the claim against the
    // trial's OWN registered statistical result (paramValue/CI/p-value) — deterministic,
    // no LLM. Reads the results cached on the source at ingestion.
    const registeredResults = (source.registered_results ?? []) as TrialResultAnalysis[];
    const registryCheck =
      source.source_type === "clinicaltrials" ? checkAgainstRegistry(claim, registeredResults) : null;

    // Persistence is best-effort and isolated: the user has already paid (Claude +
    // Voyage) for this result, so a Neon hiccup must NEVER discard it or 500 the
    // request. On failure we log and return the result with verification_id = null
    // (the permalink is simply omitted for that response).
    let verificationId: string | null = null;
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `insert into verifications
           (claim_text, matched_source_id, discrepancy_type, trust_score, explanation,
            flagged_spans, cross_source_agreement, corroborating_source_ids)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
         returning id`,
        [
          claim,
          source.id,
          verification.discrepancy_type,
          verification.trust_score,
          verification.explanation,
          JSON.stringify(verification.flagged_spans),
          verification.cross_source_agreement,
          JSON.stringify(corroboratingSources.map((s) => s.id)),
        ]
      );
      verificationId = rows[0]?.id ?? null;
    } catch (persistErr) {
      logEvent("verify.persist_error", { error: String(persistErr) });
      console.error("[/api/verify] persistence failed (result still returned):", persistErr);
    }

    logEvent("verify.success", {
      latencyMs: Date.now() - start,
      discrepancyType: verification.discrepancy_type,
      flaggedSpans: verification.flagged_spans.length,
      groundingDropped: verification.grounding_dropped_count,
      effectSizeVerdict: effectSizeCheck.verdict,
      crossSourceAgreement: verification.cross_source_agreement,
      corroboratingCount: corroboratingSources.length,
      registryVerdict: registryCheck?.verdict ?? "n/a",
      persisted: verificationId !== null,
    });

    return NextResponse.json({
      status: "verified",
      verification_id: verificationId,
      claim,
      source: {
        title: source.title,
        url: source.url,
        source_type: source.source_type,
        external_id: source.external_id,
        phase: source.phase ?? null,
        enrollment_count: source.enrollment_count ?? null,
        // Full cached source text — the UI highlights flagged spans in place using
        // the char offsets in verification.flagged_spans[].grounding.
        raw_text: source.raw_text,
      },
      corroborating_sources: corroboratingSources.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        source_type: s.source_type,
        external_id: s.external_id,
      })),
      cross_source_agreement: verification.cross_source_agreement,
      finding,
      verification,
      effect_size_check: effectSizeCheck,
      registry_check: registryCheck,
    });
  } catch (err) {
    logEvent("verify.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/verify] failed:", err);
    return NextResponse.json(
      {
        error:
          "Something went wrong while verifying this claim. This has been logged — please try again, or try a different claim.",
      },
      { status: 500 }
    );
  }
}
