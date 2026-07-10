import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { requireRole } from "@/lib/authz/rbac";
import { checkRateLimit } from "@/lib/rateLimit";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { ok, fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit";
import { logEvent } from "@/lib/logger";
import { DataChatRequestSchema } from "@/lib/dataChat/schemas";
import { runDataChatTurn } from "@/lib/dataChat/agent";

export const runtime = "nodejs";

// ORG-SCOPED Data Chat route: a conversational tool-use agent over the CALLER'S OWN
// org data (saved evidence reports, cached sources, filed claims). This route READS
// TENANT DATA, so it follows the org-route contract exactly:
//   - withOrg resolves session -> user -> org membership; the org id comes from the
//     server-verified membership, NEVER a client value. The x-org-id header is only
//     honoured if the user is actually a member (see resolveOrg in lib/api/handler).
//   - requireRole(ctx, "viewer") — any member may query their org's own library.
//   - per-ORG rate budget: attributes each (expensive, multi-model) tool-use loop to
//     the tenant and caps abuse per org.
//   - per-message sanitisation BEFORE anything reaches the model or DB.
//   - writeAudit of the query (COUNTS ONLY — never the message text).
//   - the standard { success, data, error } envelope.
//   - NEVER logs message text (only counts).
//
// Grounding + tenancy are enforced downstream in the agent loop: every tool runs
// org-scoped with ctx.org.id, and every citation/number in the answer comes from a
// tool result — never the model's memory, never another tenant's rows.

const MAX_MESSAGE_LENGTH = 8000;

export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  const start = Date.now();

  // Any member (viewer and above) may query their org's own evidence library.
  try {
    requireRole(ctx, "viewer");
  } catch (err) {
    const status = err instanceof Error && "status" in err ? (err as { status: number }).status : 403;
    return fail(err instanceof Error ? err.message : "Forbidden.", status);
  }

  // Per-org (not per-IP) budget: attributes cost to the tenant and caps abuse.
  const rate = checkRateLimit(`data-chat:${ctx.org.id}`, { max: 5 });
  if (!rate.allowed) {
    logEvent("data_chat.rate_limited", { orgId: ctx.org.id });
    return fail("Rate limit reached. Please wait a moment before sending another message.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = DataChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request.";
    return fail(`Invalid request: ${message}`, 400);
  }

  // Sanitise EACH message's text (control/invisible chars, length cap, degenerate
  // repetition) before it reaches the model. The final turn must be from the user.
  const messages = parsed.data.messages;
  if (messages[messages.length - 1].role !== "user") {
    return fail("The last message must be from the user.", 400);
  }

  const cleaned: typeof messages = [];
  for (const m of messages) {
    const s = sanitizeClaimText(m.content, {
      maxLength: MAX_MESSAGE_LENGTH,
      tooLongError: "Message is too long. Please shorten it.",
    });
    if (!s.ok) {
      return fail(s.error, 400);
    }
    cleaned.push({ role: m.role, content: s.value });
  }

  try {
    const pool = getPool();
    // orgId is the server-resolved tenant scope (ctx.org.id) — never a client value.
    const result = await runDataChatTurn(cleaned, pool, ctx.org.id);

    // Audit the query (counts only — never the message text).
    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "data_chat.query",
      entityType: "data_chat",
      metadata: {
        turns: cleaned.length,
        iterations: result.iterations,
        tool_calls: result.toolTrace.length,
        citations: result.citations.length,
      },
    });

    logEvent("data_chat.success", {
      orgId: ctx.org.id,
      latencyMs: Date.now() - start,
      turns: cleaned.length,
      iterations: result.iterations,
      toolCalls: result.toolTrace.length,
      citations: result.citations.length,
    });

    return ok(result);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    logEvent("data_chat.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/data-chat] failed:", err);
    return fail(
      "Something went wrong while running Data Chat. This has been logged — please try again.",
      500
    );
  }
});
