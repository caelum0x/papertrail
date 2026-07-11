// Public POST endpoint for ENSEMBLE ABSTRACT SCREENING (ASReview, PaperTrail-native).
//
// Given a handful of human-labeled abstracts and a pool of unlabeled ones, it runs
// ASReview's deterministic TF-IDF + Multinomial Naive Bayes core THREE times — one
// classifier per axis (include/exclude, high/low quality, low/high risk-of-bias) over
// a single shared vocabulary — and returns the unlabeled abstracts ranked by a combined
// screening priority, each tagged with the axis that decided its rank.
//
// The ranking is DETERMINISTIC math + rules (lib/screening/ensemble — no Python, no
// Claude anywhere in a score, priority, or ordering). Nothing is fabricated: too few
// labels on an axis leaves it honestly untrained, and no discriminative signal at all
// yields an empty ranking rather than a guessed order.
//
// Standard { success, data, error } envelope, IP rate-limited, Zod safeParse of the
// body, try/catch fallback, and NEVER logs abstract text — only ids/counts.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  ensembleScreen,
  type LabeledAbstract,
  type UnlabeledAbstract,
} from "@/lib/screening/ensemble";

export const runtime = "nodejs";

// A 0/1 flag as a small union so the schema rejects any other integer.
const Flag01 = z.union([z.literal(0), z.literal(1)]);

const LabeledSchema = z.object({
  text: z.string().min(1, "Each labeled abstract needs non-empty text."),
  include: Flag01,
  quality: Flag01.optional(),
  rob: Flag01.optional(),
});

const UnlabeledSchema = z.object({
  id: z.string().min(1, "Each unlabeled abstract needs a non-empty id."),
  text: z.string().min(1, "Each unlabeled abstract needs non-empty text."),
});

const EnsembleRequestSchema = z.object({
  labeled: z
    .array(LabeledSchema)
    .max(2000, "At most 2000 labeled abstracts per request."),
  unlabeled: z
    .array(UnlabeledSchema)
    .max(5000, "At most 5000 unlabeled abstracts per request."),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(`screening-ensemble:${ip}`);
  if (!rate.allowed) {
    logEvent("screening.ensemble.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = EnsembleRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid ensemble-screening request — ${where}${issue?.message ?? "provide labeled and unlabeled abstract arrays."}`,
      400
    );
  }

  try {
    const labeled: readonly LabeledAbstract[] = parsed.data.labeled;
    const unlabeled: readonly UnlabeledAbstract[] = parsed.data.unlabeled;

    const result = ensembleScreen(labeled, unlabeled);

    logEvent("screening.ensemble.success", {
      latencyMs: Date.now() - start,
      labeled: result.meta.labeled,
      unlabeled: result.meta.unlabeled,
      vocabularySize: result.meta.vocabularySize,
      axesTrained: result.meta.axesTrained.length,
      ranked: result.ranking.length,
    });

    return ok(result);
  } catch (err) {
    logEvent("screening.ensemble.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/screening/ensemble] failed:", err);
    return fail(
      "Something went wrong while screening abstracts. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
