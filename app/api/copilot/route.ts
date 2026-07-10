import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { requireRole } from "@/lib/authz/rbac";
import { checkRateLimit } from "@/lib/rateLimit";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { ok, fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit";
import { logEvent } from "@/lib/logger";
import { CopilotRequestSchema } from "@/lib/copilot/schemas";
import { runCopilotTurn } from "@/lib/copilot/agent";

export const runtime = "nodejs";

// ORG-SCOPED copilot route: a conversational tool-use agent over PaperTrail's engines.
// Auth + RBAC via withOrg (any member may query); a per-ORG rate budget so copilot
// cost is attributed and abuse-capped per tenant (each turn runs a multi-step, multi-
// model tool-use loop — far more expensive than a single verify); per-message
// sanitisation BEFORE anything reaches the model or DB; a writeAudit trail; and the
// standard { success, data, error } envelope. NEVER logs message text (only counts).
//
// Grounding is enforced downstream by the agent loop: every citation and every number
// in the answer comes from a tool result, never the model's memory.

const MAX_MESSAGE_LENGTH = 8000;

export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  const start = Date.now();

  // Any authenticated org member (viewer and above) may use the copilot.
  // Explicit check mirrors data-chat for defense-in-depth consistency.
  try {
    requireRole(ctx, "viewer");
  } catch (err) {
    const status = err instanceof Error && "status" in err ? (err as { status: number }).status : 403;
    return fail(err instanceof Error ? err.message : "Forbidden.", status);
  }

  // Per-org (not per-IP) budget: attributes cost to the tenant and caps abuse.
  const rate = checkRateLimit(`copilot:${ctx.org.id}`, { max: 5 });
  if (!rate.allowed) {
    logEvent("copilot.rate_limited", { orgId: ctx.org.id });
    return fail("Rate limit reached. Please wait a moment before sending another message.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = CopilotRequestSchema.safeParse(body);
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
    const result = await runCopilotTurn(cleaned, pool);

    // Audit the query (counts only — never the message text).
    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "copilot.query",
      entityType: "copilot",
      metadata: {
        turns: cleaned.length,
        iterations: result.iterations,
        tool_calls: result.toolTrace.length,
        citations: result.citations.length,
      },
    });

    logEvent("copilot.success", {
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
    logEvent("copilot.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/copilot] failed:", err);
    return fail(
      "Something went wrong while running the research copilot. This has been logged — please try again.",
      500
    );
  }
});
