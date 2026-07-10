// Public search over the OpenAlex Works corpus via the native TS client
// (lib/sources/openalex). Broadens PaperTrail's sources beyond PubMed /
// ClinicalTrials.gov. Rate-limited; validated with Zod; ok/fail envelope; the
// query text is never logged (only metadata).

import { NextRequest } from "next/server";
import { z } from "zod";
import { searchOpenAlex } from "@/lib/sources/openalex";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { ok, fail } from "@/lib/api/response";

export const runtime = "nodejs";

const querySchema = z.object({
  q: z.string().trim().min(1, "q is required").max(500),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("openalex.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: searchParams.get("q") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    // Report the validation issue, never the query value.
    return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
  }

  try {
    const works = await searchOpenAlex({
      query: parsed.data.q,
      limit: parsed.data.limit,
    });
    logEvent("openalex.search", {
      count: works.length,
      limit: parsed.data.limit ?? null,
      latencyMs: Date.now() - start,
    });
    return ok(works, { total: works.length });
  } catch {
    logEvent("openalex.search_error", { latencyMs: Date.now() - start });
    return fail("Couldn't search OpenAlex. Please try again shortly.", 502);
  }
}
