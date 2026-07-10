import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { checkClaimsSupported, type FactCheckPair } from "@/lib/engines/factCheck";

// Public supplementary entailment fact-check endpoint. Given (claim, doc) pairs,
// it asks the opt-in MiniCheck engine whether each claim is *supported* (entailed)
// by its document — a complement to verbatim-span grounding (lib/grounding.ts).
//
// Mirrors app/api/verify + app/api/paper-qa conventions: nodejs runtime,
// rate-limited, envelope responses ({ success, data, error }), Zod-validated,
// input-sanitized, and NEVER logs claim/doc text. When MiniCheck is disabled
// (the default) or its bridge rejects, checkClaimsSupported returns null and we
// respond honestly with checked:false rather than fabricating verdicts.
export const runtime = "nodejs";

// Bounds keep a single request from spawning an unbounded MiniCheck workload and
// from burning tokens/CPU on absurd input. Text quality is enforced separately by
// sanitizeClaimText below (control chars, invisible/bidi smuggling, repetition).
const MAX_PAIRS = 20;
const MAX_CLAIM_CHARS = 2000;
const MAX_DOC_CHARS = 50_000;

const bodySchema = z.object({
  pairs: z
    .array(
      z.object({
        claim: z.string(),
        doc: z.string(),
      })
    )
    .min(1, "Provide at least one (claim, doc) pair.")
    .max(MAX_PAIRS, `Too many pairs (max ${MAX_PAIRS}).`),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("fact_check.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
  }

  // Harden every claim and doc string BEFORE any subprocess sees it: control
  // characters, invisible/bidi smuggling, degenerate repetition, and length caps.
  // Never echo the offending text back — only the pair index and a generic reason.
  const pairs: FactCheckPair[] = [];
  for (let i = 0; i < parsed.data.pairs.length; i++) {
    const p = parsed.data.pairs[i];

    const claim = sanitizeClaimText(p.claim, {
      maxLength: MAX_CLAIM_CHARS,
      tooLongError: `Claim in pair ${i} is too long (max ${MAX_CLAIM_CHARS} characters).`,
    });
    if (!claim.ok) {
      return fail(`Pair ${i}: ${claim.error}`, 400);
    }

    const doc = sanitizeClaimText(p.doc, {
      maxLength: MAX_DOC_CHARS,
      tooLongError: `Document in pair ${i} is too long (max ${MAX_DOC_CHARS} characters).`,
    });
    if (!doc.ok) {
      return fail(`Pair ${i}: ${doc.error}`, 400);
    }

    pairs.push({ claim: claim.value, doc: doc.value });
  }

  try {
    const result = await checkClaimsSupported(pairs);

    // null => MiniCheck disabled or bridge rejected. Report honestly rather than
    // inventing entailment verdicts; callers treat checked:false as "not checked".
    if (result === null) {
      logEvent("fact_check.not_checked", {
        latencyMs: Date.now() - start,
        pairs: pairs.length,
      });
      return ok({ checked: false, results: [] });
    }

    logEvent("fact_check.success", {
      latencyMs: Date.now() - start,
      pairs: pairs.length,
      supported: result.results.filter((r) => r.supported).length,
    });
    return ok({ checked: true, results: result.results });
  } catch (err) {
    // Defensive: checkClaimsSupported already swallows bridge failures, but keep a
    // fallback so a bug there can never leak a 500 with claim/doc text.
    logEvent("fact_check.error", { latencyMs: Date.now() - start, error: String(err) });
    return fail(
      "Something went wrong while fact-checking. This has been logged — please try again.",
      500
    );
  }
}
