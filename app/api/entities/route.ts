import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { recognizeEntities } from "@/lib/entities/ner";
import { EntitiesRequestSchema } from "@/lib/entities/schemas";

// Public POST endpoint for BIOMEDICAL NER + ENTITY LINKING (native scispaCy port).
//
// { text } -> Claude does the NER (proposes candidate mention spans + a coarse
//   gene/disease/chemical/variant type); a DETERMINISTIC native linker maps each mention
//   to a normalized concept id (UMLS CUI / MeSH id) via an in-code dictionary; each
//   mention span is GROUNDED verbatim to the input via lib/grounding (offsets), and
//   ungroundable mentions are DROPPED. Abbreviations are resolved natively
//   (Schwartz-Hearst) so a short form links via its long form.
//
// The normalized id and score are NOT LLM numbers — Claude only proposes candidate
// mentions; grounding, abbreviation resolution, and linking are deterministic code. On
// LLM/upstream failure the run degrades to an honest empty result rather than
// fabricating entities.
//
// The caller's source text is NEVER logged (only entity/drop counts and latency).
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("entities.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request body.
  const parsed = EntitiesRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid entities request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  try {
    const result = await recognizeEntities({ text: parsed.data.text });
    logEvent("entities.recognize.success", {
      latencyMs: Date.now() - start,
      entities: result.entities.length,
      linkedCount: result.linkedCount,
      groundingDroppedCount: result.groundingDroppedCount,
    });
    // Never echo the source text back; return only the auditable NER result.
    return ok(result);
  } catch (err) {
    logEvent("entities.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/entities] failed:", err);
    return fail(
      "Something went wrong while recognizing entities. This has been logged — please try again.",
      500
    );
  }
}
