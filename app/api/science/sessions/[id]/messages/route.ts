import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { postMessageSchema } from "@/lib/science/types";
import {
  getSession,
  listMessages,
  createMessage,
} from "@/lib/science/queries";
import { runResearchTurn, getWorkbenchStatus } from "@/lib/science/client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_ARTIFACTS = {
  literatureQueries: [],
  citations: [],
  nextSteps: [],
};

// POST /api/science/sessions/[id]/messages — append a user turn and generate the
// assistant's research reply. Editor+. Persists both messages; if the assistant
// call fails, the user message is still saved and an honest error is returned.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid session id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = postMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const session = await getSession(pool, ctx.org.id, id);
    if (!session) {
      return fail("Research session not found.", 404);
    }

    const history = await listMessages(pool, ctx.org.id, id);

    const userMessage = await createMessage(pool, {
      orgId: ctx.org.id,
      sessionId: id,
      role: "user",
      content: parsed.data.content,
      artifacts: EMPTY_ARTIFACTS,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "science.message.create",
      entityType: "science_session",
      entityId: id,
      metadata: { role: "user" },
    });

    let reply;
    try {
      const status = getWorkbenchStatus();
      reply = await runResearchTurn({
        history,
        userMessage: parsed.data.content,
        workbenchEndpoint: status.endpoint,
      });
    } catch {
      // The user's turn is already persisted; surface an honest failure rather
      // than fabricating an assistant reply.
      return fail(
        "The research assistant is temporarily unavailable. Your message was saved — please try again.",
        502
      );
    }

    const assistantMessage = await createMessage(pool, {
      orgId: ctx.org.id,
      sessionId: id,
      role: "assistant",
      content: reply.content,
      artifacts: reply.artifacts,
    });

    return created({ userMessage, assistantMessage });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to post message.", 500);
  }
});
