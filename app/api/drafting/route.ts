// PUBLIC compute route for the DRAFT ASSISTANT. Mirrors app/api/verify/route.ts:
// nodejs runtime, IP rate-limited, boundary-sanitized input, standard { success,
// data, error } envelope, and NEVER logs the topic/claim text (only metadata). Claude
// drafts a section grounded in the engine's verified evidence and the engine
// self-corrects every efficacy sentence — see lib/drafting/assist.ts.

import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { runDraftAssist } from "@/lib/drafting/assist";
import { DRAFT_SECTION_TYPES, type DraftSectionType } from "@/lib/drafting/schemas";

export const runtime = "nodejs";

function parseSection(value: unknown): DraftSectionType | undefined {
  if (typeof value === "string" && (DRAFT_SECTION_TYPES as readonly string[]).includes(value)) {
    return value as DraftSectionType;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("drafting.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: { topic?: unknown; section?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Same input hardening as /api/verify: strip control/invisible chars, cap length.
  const sanitized = sanitizeClaimText(body.topic, {
    maxLength: 2000,
    tooLongError: "Topic is too long (max 2000 characters). Paste a single claim or short passage.",
  });
  if (!sanitized.ok) {
    return fail(sanitized.error, 400);
  }
  const topic = sanitized.value;
  if (topic.length < 10) {
    return fail("Please provide a topic of at least 10 characters.", 400);
  }

  const section = parseSection(body.section);

  try {
    const result = await runDraftAssist(getPool(), { topic, section });

    logEvent("drafting.success", {
      latencyMs: Date.now() - start,
      section: result.section,
      sources: result.sources.length,
      sentences: result.summary.totalSentences,
      efficacyClaims: result.summary.efficacyClaims,
      grounded: result.summary.grounded,
      corrected: result.summary.corrected,
      evidenceSufficient: result.evidence.sufficient,
    });

    return ok(result);
  } catch (err) {
    logEvent("drafting.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/drafting] failed:", err);
    return fail(
      "Something went wrong while drafting this section. This has been logged — please try again, or try a different topic.",
      500
    );
  }
}
