import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { resolveEntity, resolveMany, type CanonicalEntity } from "@/lib/entities/canonicalize";

// Public POST endpoint for DETERMINISTIC ENTITY CANONICALIZATION.
//
// Given { surface } or { surfaces: [...] } (plus an optional coarse `type` to
// disambiguate) it resolves each surface form to a stable ontology concept
// (CURIE + canonical label + cross-refs) via an exact, normalized lexical lookup against
// the 0062 ontology tables. NO LLM: id resolution is pure parameterized SQL, so the
// answer is reproducible and auditable. A surface that matches nothing resolves to null
// (an honest miss), never a fabricated concept.
//
// The caller's surface text is NEVER logged — only counts and latency.
export const runtime = "nodejs";

// Validate at the boundary — never trust the raw request body. Exactly one of `surface`
// (single) or `surfaces` (batch) must be supplied; `type` narrows the resolution.
const SingleRequestSchema = z.object({
  surface: z.string().trim().min(1).max(200),
  surfaces: z.undefined().optional(),
  type: z.string().trim().min(1).max(64).optional(),
});

const BatchRequestSchema = z.object({
  surface: z.undefined().optional(),
  surfaces: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
  type: z.string().trim().min(1).max(64).optional(),
});

const CanonicalizeRequestSchema = z.union([SingleRequestSchema, BatchRequestSchema]);

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("entities.canonicalize.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = CanonicalizeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid canonicalize request — ${where}${issue?.message ?? "provide a 'surface' string or a non-empty 'surfaces' array."}`,
      400
    );
  }

  try {
    const pool = getPool();
    const { type } = parsed.data;

    // Batch form → an ordered list aligned 1:1 with `surfaces` (null per unresolved slot).
    if (parsed.data.surfaces !== undefined) {
      const results: Array<CanonicalEntity | null> = await resolveMany(
        pool,
        parsed.data.surfaces,
        type
      );
      logEvent("entities.canonicalize.success", {
        latencyMs: Date.now() - start,
        mode: "batch",
        count: results.length,
        resolvedCount: results.filter((r) => r !== null).length,
      });
      return ok(results);
    }

    // Single form → one CanonicalEntity or null.
    const result: CanonicalEntity | null = await resolveEntity(pool, parsed.data.surface, type);
    logEvent("entities.canonicalize.success", {
      latencyMs: Date.now() - start,
      mode: "single",
      resolved: result !== null,
    });
    return ok(result);
  } catch (err) {
    logEvent("entities.canonicalize.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/entities/canonicalize] failed:", err);
    return fail(
      "Something went wrong while canonicalizing entities. This has been logged — please try again.",
      500
    );
  }
}
