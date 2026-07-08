import { NextRequest, NextResponse } from "next/server";
import { callClaudeForJson } from "@/lib/claude";
import { ExtractedFindingSchema } from "@/lib/schemas";
import { verifyClaim } from "@/lib/agents/verificationAgent";
import { checkRateLimit } from "@/lib/rateLimit";
import { reconcile } from "@/lib/effectSize";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

// Same extraction system prompt style as lib/agents/extractionAgent.ts. We inline
// an UNCACHED extraction here because there is no DB source row to key a cache on —
// "bring your own source" verifies against arbitrary pasted text, so this path
// depends only on the Claude API (no retrieval, no Neon lookup).
const EXTRACTION_SYSTEM_PROMPT = `You are a precise scientific data extraction assistant.
Given the text of a clinical trial record or paper abstract, extract ONLY what
is explicitly stated. Do not infer, generalize, or fill in gaps with typical
values from similar studies. If a field is not stated, use "not reported".
Respond with ONLY a single JSON object matching this shape, no other text:
{
  "effect_size": string,
  "population": string,
  "condition": string,
  "endpoint": string,
  "caveats": string[]
}`;

const MIN_CLAIM_CHARS = 10;
const MIN_SOURCE_CHARS = 40;
const MAX_SOURCE_CHARS = 20000;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("verify_text.rate_limited", { ip });
    return NextResponse.json(
      { error: "Rate limit reached. Please try again shortly." },
      { status: 429 }
    );
  }

  let body: { claim?: string; source_text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const claim = body.claim?.trim();
  if (!claim || claim.length < MIN_CLAIM_CHARS) {
    return NextResponse.json(
      { error: `Please provide a claim of at least ${MIN_CLAIM_CHARS} characters.` },
      { status: 400 }
    );
  }

  const sourceText = body.source_text?.trim();
  if (!sourceText || sourceText.length < MIN_SOURCE_CHARS) {
    return NextResponse.json(
      { error: `Please paste source text of at least ${MIN_SOURCE_CHARS} characters.` },
      { status: 400 }
    );
  }
  if (sourceText.length > MAX_SOURCE_CHARS) {
    return NextResponse.json(
      { error: `Source text is too long (max ${MAX_SOURCE_CHARS} characters). Paste an abstract or a focused passage.` },
      { status: 400 }
    );
  }

  try {
    // Uncached extraction — same prompt/schema/truncation as extractFinding, but
    // without the DB read/write, since there is no persisted source to key on.
    const finding = await callClaudeForJson({
      system: EXTRACTION_SYSTEM_PROMPT,
      user: `Source text:\n\n${sourceText.slice(0, 12000)}`,
      schema: ExtractedFindingSchema,
      maxTokens: 700,
    });

    // Grounds every flagged source_span against the pasted text (drops any it can't
    // locate verbatim) — same trust invariant as the retrieval-backed path.
    const verification = await verifyClaim({ claim, finding, sourceRawText: sourceText });

    // Deterministic numeric cross-check over the same pasted text.
    const effectSizeCheck = reconcile(claim, sourceText);

    logEvent("verify_text.success", {
      latencyMs: Date.now() - start,
      discrepancyType: verification.discrepancy_type,
      flaggedSpans: verification.flagged_spans.length,
      groundingDropped: verification.grounding_dropped_count,
      effectSizeVerdict: effectSizeCheck.verdict,
    });

    // No DB persistence: there is no matched source row, so no permalink is minted.
    return NextResponse.json({
      status: "verified",
      claim,
      source: {
        title: "Pasted source",
        url: "",
        source_type: "custom",
        raw_text: sourceText,
      },
      finding,
      verification,
      effect_size_check: effectSizeCheck,
    });
  } catch (err) {
    logEvent("verify_text.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/verify/text] failed:", err);
    return NextResponse.json(
      {
        error:
          "Something went wrong while verifying this claim against your source. This has been logged — please try again.",
      },
      { status: 500 }
    );
  }
}
