import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVerificationRow } from "@/lib/queries/verifications";
import { groundFlaggedSpans } from "@/lib/grounding";
import { reconcile, Reconciliation } from "@/lib/effectSize";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

// LLM-free shareable permalink for a single stored verification. This route never
// calls the model: it reads the persisted verdict and RE-GROUNDS the stored flagged
// spans against the *current* cached source text, so the returned char offsets are
// always valid for the source as it exists now. The payload deliberately mirrors the
// POST /api/verify success shape so the same VerificationView can render a shared link.

// Validate the [id] up front — never hand junk to the SQL layer.
const idSchema = z.string().uuid();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: verificationId } = await params;
  const parsed = idSchema.safeParse(verificationId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid verification id." }, { status: 400 });
  }
  const id = parsed.data;

  try {
    const row = await getVerificationRow(id);

    if (!row) {
      return NextResponse.json({ error: "Verification not found." }, { status: 404 });
    }

    // The source may be gone (raw_text null). In that case we still return the stored
    // verdict, but with no source and no grounded spans — offsets would be meaningless
    // without the text they point into, and we never fabricate a source.
    const rawText = row.raw_text;
    const storedSpans = row.flagged_spans ?? [];

    const flagged_spans =
      rawText === null ? [] : groundFlaggedSpans(storedSpans, rawText).spans;

    // Recompute the deterministic numeric cross-check against the current cached text.
    const effect_size_check: Reconciliation | null =
      rawText === null ? null : reconcile(row.claim_text, rawText);

    const source =
      rawText === null
        ? null
        : {
            title: row.title,
            url: row.url,
            source_type: row.source_type,
            external_id: row.external_id,
            raw_text: rawText,
          };

    logEvent("verification.read", {
      verificationId: id,
      discrepancyType: row.discrepancy_type,
      hasSource: rawText !== null,
      flaggedSpans: flagged_spans.length,
    });

    return NextResponse.json({
      status: "verified",
      verification_id: id,
      claim: row.claim_text,
      created_at: row.created_at,
      source,
      verification: {
        discrepancy_type: row.discrepancy_type,
        trust_score: row.trust_score,
        explanation: row.explanation,
        flagged_spans,
      },
      effect_size_check,
    });
  } catch (err) {
    logEvent("verification.read.error", { verificationId: id, error: String(err) });
    return NextResponse.json(
      { error: "Something went wrong while loading this verification. Please try again." },
      { status: 500 }
    );
  }
}
