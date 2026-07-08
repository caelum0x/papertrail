import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { updateTicketSchema } from "@/lib/help/types";
import { getTicket, listMessages, updateTicket } from "@/lib/help/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/support/tickets/[id] — one ticket plus its full message thread. Any
// member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid ticket id.", 400);
    }
    const pool = getPool();
    const ticket = await getTicket(pool, ctx.org.id, id);
    if (!ticket) {
      return fail("Ticket not found.", 404);
    }
    const messages = await listMessages(pool, ctx.org.id, id);
    return ok({ ticket, messages });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load ticket.", 500);
  }
});

// PATCH /api/support/tickets/[id] — update a ticket's status/priority (triage).
// Editor+. Audited.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid ticket id.", 400);
    }
    const raw = await req.json().catch(() => null);
    const parsed = updateTicketSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getTicket(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Ticket not found.", 404);
    }

    const updated = await updateTicket(pool, ctx.org.id, id, {
      status: parsed.data.status,
      priority: parsed.data.priority,
    });
    if (!updated) {
      return fail("Ticket not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "support_ticket.update",
      entityType: "support_ticket",
      entityId: id,
      metadata: { status: updated.status, priority: updated.priority },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update ticket.", 500);
  }
});
