import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { createAeSignalSchema } from "@/lib/monitoring/schemas";
import { listSignals, createSignal } from "@/lib/monitoring/repo";
import {
  AE_STATUSES,
  AE_SEVERITIES,
  type AeStatus,
  type AeSeverity,
} from "@/lib/monitoring/types";

export const runtime = "nodejs";

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

function parseStatus(value: string | null): AeStatus | undefined {
  if (value && (AE_STATUSES as readonly string[]).includes(value)) {
    return value as AeStatus;
  }
  return undefined;
}

function parseSeverity(value: string | null): AeSeverity | undefined {
  if (value && (AE_SEVERITIES as readonly string[]).includes(value)) {
    return value as AeSeverity;
  }
  return undefined;
}

// GET /api/ae-signals — paginated, org-scoped adverse-event signal board.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);
    const drugRaw = url.searchParams.get("drug");

    const { items, total } = await listSignals({
      orgId: ctx.org.id,
      limit,
      offset,
      status: parseStatus(url.searchParams.get("status")),
      severity: parseSeverity(url.searchParams.get("severity")),
      drug: drugRaw && drugRaw.trim().length > 0 ? drugRaw.trim() : undefined,
    });

    return ok(items, { total, page, limit });
  } catch {
    return fail("Couldn't load AE signals. Please try again.", 500);
  }
});

// POST /api/ae-signals — raise a new adverse-event signal.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createAeSignalSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid signal.", 400);
    }

    const signal = await createSignal({ ...parsed.data, orgId: ctx.org.id });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "ae_signal.create",
      entityType: "ae_signal",
      entityId: signal.id,
      metadata: { drug: signal.drug, event: signal.event, severity: signal.severity },
    });

    return created(signal);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't create the signal. Please try again.", 500);
  }
});
