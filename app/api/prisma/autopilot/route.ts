import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { ok, fail } from "@/lib/api/response";
import { logEvent } from "@/lib/logger";
import { runPrismaAutopilot } from "@/lib/prisma/autopilot";
import { PrismaAutopilotInputSchema } from "@/lib/prisma/schemas";

export const runtime = "nodejs";

// PUBLIC compute route: a research question + inclusion criteria IN → a full PRISMA
// systematic-review run OUT (identify → screen → extract → synthesise). Mirrors the
// hardening of /api/verify and /api/evidence-pipeline exactly — nodejs runtime, IP
// rate limiting, question/criteria sanitisation BEFORE anything downstream, standard
// { success, data, error } envelope via ok/fail, and NEVER logging the question or
// criteria text. The heavy Claude fan-out (screening + extraction) and the
// deterministic synthesis all live behind runPrismaAutopilot.

const MAX_QUESTION_LENGTH = 2000;
const MAX_CRITERION_LENGTH = 500;
const MAX_CRITERIA = 50;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("prisma_autopilot.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: {
    question?: unknown;
    criteria?: unknown;
    source_ids?: unknown;
    limit?: unknown;
    include_threshold?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Sanitise the question the same way the other public compute routes sanitise a claim:
  // strip control/invisible chars, normalise whitespace, cap length — all BEFORE the
  // question reaches ingestion, screening, or the DB.
  const sanitizedQuestion = sanitizeClaimText(body.question, {
    maxLength: MAX_QUESTION_LENGTH,
    tooLongError:
      "Question is too long (max 2000 characters). State a single systematic-review question.",
  });
  if (!sanitizedQuestion.ok) {
    return fail(sanitizedQuestion.error, 400);
  }
  const question = sanitizedQuestion.value;
  if (question.length < 10) {
    return fail("Please provide a review question of at least 10 characters.", 400);
  }

  // Criteria: array of strings, each sanitised. Absent/empty means Claude screens on
  // general topical relevance to the question (aiRank's own fallback).
  let criteria: string[] = [];
  if (body.criteria !== undefined && body.criteria !== null) {
    if (!Array.isArray(body.criteria)) {
      return fail("`criteria` must be an array of strings.", 400);
    }
    if (body.criteria.length > MAX_CRITERIA) {
      return fail(`Provide at most ${MAX_CRITERIA} inclusion criteria.`, 400);
    }
    const cleaned: string[] = [];
    for (const raw of body.criteria) {
      const s = sanitizeClaimText(raw, {
        maxLength: MAX_CRITERION_LENGTH,
        tooLongError: `Each criterion must be at most ${MAX_CRITERION_LENGTH} characters.`,
      });
      if (!s.ok) return fail(s.error, 400);
      if (s.value.length > 0) cleaned.push(s.value);
    }
    criteria = cleaned;
  }

  // Optional pinned candidate set (already-cached source ids) — schema enforces uuid.
  let sourceIds: string[] | undefined;
  if (body.source_ids !== undefined && body.source_ids !== null) {
    if (!Array.isArray(body.source_ids)) {
      return fail("`source_ids` must be an array of source ids.", 400);
    }
    sourceIds = body.source_ids as string[];
  }

  // Optional ingestion limit + include threshold — validated by the schema below, but
  // reject obviously wrong types at the boundary for a clean message.
  let limit: number | undefined;
  if (body.limit !== undefined) {
    const n = Number(body.limit);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      return fail("`limit` must be an integer between 1 and 50.", 400);
    }
    limit = n;
  }

  let includeThreshold: number | undefined;
  if (body.include_threshold !== undefined) {
    const n = Number(body.include_threshold);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return fail("`include_threshold` must be a number between 0 and 1.", 400);
    }
    includeThreshold = n;
  }

  // Final Zod validation at the boundary — never trust the assembled object without it.
  const inputParse = PrismaAutopilotInputSchema.safeParse({
    question,
    criteria,
    source_ids: sourceIds,
    limit,
    include_threshold: includeThreshold,
  });
  if (!inputParse.success) {
    return fail(inputParse.error.issues[0]?.message ?? "Invalid request.", 400);
  }

  try {
    const pool = getPool();
    const result = await runPrismaAutopilot(pool, inputParse.data);

    logEvent("prisma_autopilot.success", {
      latencyMs: Date.now() - start,
      identified: result.counts.identified,
      screened: result.counts.screened,
      included: result.counts.included,
      extractedWithEffects: result.counts.extractedWithEffects,
      reportOk: result.report?.ok ?? null,
    });

    return ok(result);
  } catch (err) {
    logEvent("prisma_autopilot.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/prisma/autopilot] failed:", err);
    return fail(
      "Something went wrong while running the PRISMA autopilot. This has been logged — please try again, or narrow the question.",
      500
    );
  }
}
