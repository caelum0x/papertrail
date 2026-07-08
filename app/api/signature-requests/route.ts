import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  createRequestSchema,
  listRequestsQuerySchema,
} from "@/lib/signatures/schemas";
import { listRequests, createRequest } from "@/lib/signatures/repository";
import type {
  SignatureRequest,
  SignatureRequestDetail,
} from "@/lib/signatures/types";

export const runtime = "nodejs";

// GET /api/signature-requests — list this org's signature requests, newest
// first, paginated. Filterable by status and entityType. Any member (viewer+).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const url = new URL(req.url);
    const parsed = listRequestsQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      entityType: url.searchParams.get("entityType") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }
    const { limit, offset, page } = parsePagination(req);

    const { items, total } = await listRequests(getPool(), {
      orgId: ctx.org.id,
      status: parsed.data.status,
      entityType: parsed.data.entityType,
      limit,
      offset,
    });
    return ok<SignatureRequest[]>(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load signature requests.", 500);
  }
});

// POST /api/signature-requests — create a request, optionally seeding signers.
// Editor+ (creating a signing ceremony is a content mutation).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");
    const json = await req.json().catch(() => null);
    const parsed = createRequestSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const detail = await createRequest(pool, {
      orgId: ctx.org.id,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      title: parsed.data.title,
      createdBy: ctx.user.id,
      signerUserIds: parsed.data.signerUserIds,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "signature_request.created",
      entityType: "signature_request",
      entityId: detail.request.id,
      metadata: {
        title: detail.request.title,
        entityType: detail.request.entityType,
        entityId: detail.request.entityId,
        signerCount: detail.signers.length,
        status: detail.request.status,
      },
    });

    return created<SignatureRequestDetail>(detail);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create signature request.", 500);
  }
});
