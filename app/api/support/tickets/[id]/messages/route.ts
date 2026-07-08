import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createMessageSchema } from "@/lib/help/types";
import { getTicket, createMessage } from "@/lib/help/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/support/tickets/[id]/messages — add a reply to a ticket thread. Any
// member (viewer+) may reply. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid ticket id.", 400);
    }
    const raw = await req.json().catch(() => null);
    const parsed = createMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const ticket = await getTicket(pool, ctx.org.id, id);
    if (!ticket) {
      return fail("Ticket not found.", 404);
    }

    const message = await createMessage(pool, {
      orgId: ctx.org.id,
      ticketId: id,
      authorId: ctx.user.id,
      body: parsed.data.body,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "ticket_message.create",
      entityType: "ticket_message",
      entityId: message.id,
      metadata: { ticketId: id },
    });

    return created(message);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to post message.", 500);
  }
});
