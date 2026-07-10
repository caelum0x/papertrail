import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { getPool } from "@/lib/db";
import { extractPaper, type PaperSourceMeta } from "@/lib/extraction/paperExtract";

// Public structured paper-extraction endpoint (RobotReviewer / LlamaExtract-style).
// Given a full paper text OR a cached source_id, Claude READS the full text and
// extracts PICO + endpoints + every reported effect size — and the deterministic
// trust layer grounds each effect's quote to an exact source span and reconciles
// its number (lib/grounding + lib/effectSize). Effects that can't be grounded are
// dropped. Mirrors app/api/verify/route.ts: nodejs runtime, rate-limited, envelope
// responses, input sanitized, and NEVER logs the paper text.
export const runtime = "nodejs";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 60_000;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("extraction.paper.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: { text?: unknown; source_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const hasText = typeof body.text === "string" && body.text.trim().length > 0;
  const hasSourceId = typeof body.source_id === "string" && body.source_id.trim().length > 0;

  if (!hasText && !hasSourceId) {
    return fail("Provide either 'text' (the paper) or 'source_id' (a cached source).", 400);
  }

  try {
    let rawText: string;
    let sourceMeta: PaperSourceMeta = {};

    if (hasSourceId) {
      const sourceId = (body.source_id as string).trim();
      if (!uuidRe.test(sourceId)) {
        return fail("Invalid source_id — expected a source UUID.", 400);
      }
      const pool = getPool();
      const { rows } = await pool.query(
        `select id, source_type, external_id, title, raw_text, url
         from sources where id = $1 limit 1`,
        [sourceId]
      );
      if (rows.length === 0) {
        return fail("No cached source with that id was found.", 404);
      }
      const row = rows[0];
      rawText = row.raw_text;
      sourceMeta = {
        id: row.id,
        title: row.title,
        external_id: row.external_id,
        source_type: row.source_type,
        url: row.url,
      };
    } else {
      // Reuse the shared free-text hardening (control chars, invisible/bidi
      // smuggling, degenerate repetition, max length) before any LLM sees it.
      const sanitized = sanitizeClaimText(body.text, {
        maxLength: MAX_TEXT,
        tooLongError: `Paper text is too long (max ${MAX_TEXT} characters). Paste the abstract + results, or use a cached source_id.`,
      });
      if (!sanitized.ok) {
        return fail(sanitized.error, 400);
      }
      if (sanitized.value.length < 100) {
        return fail("Please paste at least 100 characters of paper text.", 400);
      }
      rawText = sanitized.value;
    }

    const result = await extractPaper(rawText, sourceMeta);

    // Metadata only — never the paper text or extracted quotes.
    const confirmed = result.effects.filter((e) => e.reconciliation === "confirmed").length;
    logEvent("extraction.paper.success", {
      latencyMs: Date.now() - start,
      source: hasSourceId ? "source_id" : "text",
      endpoints: result.endpoints.length,
      effectsGrounded: result.effects.length,
      effectsDropped: result.ungrounded_dropped_count,
      effectsConfirmed: confirmed,
    });

    return ok(result);
  } catch (err) {
    logEvent("extraction.paper.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/extraction/paper] failed:", err);
    return fail(
      "Something went wrong while extracting this paper. This has been logged — please try again, or try a different paper.",
      500
    );
  }
}
