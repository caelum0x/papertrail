import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  createTicketSchema,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  type TicketStatus,
  type TicketPriority,
} from "@/lib/help/types";
import { listTickets, countTickets, createTicket } from "@/lib/help/queries";

// GET /api/support/tickets — paginated, org-scoped list. Optional ?status,
// ?priority, ?search (subject ILIKE). Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const statusRaw = url.searchParams.get("status")?.trim();
    if (statusRaw && !TICKET_STATUSES.includes(statusRaw as TicketStatus)) {
      return fail("Invalid status filter.", 400);
    }
    const priorityRaw = url.searchParams.get("priority")?.trim();
    if (priorityRaw && !TICKET_PRIORITIES.includes(priorityRaw as TicketPriority)) {
      return fail("Invalid priority filter.", 400);
    }
    const filters = {
      status: (statusRaw as TicketStatus) || undefined,
      priority: (priorityRaw as TicketPriority) || undefined,
      search: url.searchParams.get("search")?.trim() || undefined,
    };

    const pool = getPool();
    const [tickets, total] = await Promise.all([
      listTickets(pool, ctx.org.id, filters, limit, offset),
      countTickets(pool, ctx.org.id, filters),
    ]);
    return ok(tickets, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load tickets.", 500);
  }
});

// POST /api/support/tickets — open a new support ticket. Any member (viewer+) may
// file one. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const raw = await req.json().catch(() => null);
    const parsed = createTicketSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const ticket = await createTicket(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      subject: parsed.data.subject,
      body: parsed.data.body,
      priority: parsed.data.priority ?? "normal",
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "support_ticket.create",
      entityType: "support_ticket",
      entityId: ticket.id,
      metadata: { subject: ticket.subject, priority: ticket.priority },
    });

    return created(ticket);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create ticket.", 500);
  }
});
