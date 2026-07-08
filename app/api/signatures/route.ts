import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { createSignatureSchema } from "@/lib/compliance/schemas";
import { signEntity, listSignatures } from "@/lib/compliance/esign";
import type { Signature } from "@/lib/compliance/types";

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

// GET /api/signatures?entityType=&entityId= — paginated, org-scoped e-signatures.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entityType") ?? undefined;
    const entityId = url.searchParams.get("entityId") ?? undefined;

    const { items, total } = await listSignatures({
      orgId: ctx.org.id,
      limit,
      offset,
      entityType: entityType && entityType.trim().length > 0 ? entityType.trim() : undefined,
      entityId: entityId && entityId.trim().length > 0 ? entityId.trim() : undefined,
    });

    return ok<Signature[]>(items, { total, page, limit });
  } catch {
    return fail("Couldn't load signatures. Please try again.", 500);
  }
});

// POST /api/signatures — e-sign an entity. Records a signature bound to the WORM
// audit chain. Requires editor+ (an attestable action).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createSignatureSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid signature.", 400);
    }

    const signature = await signEntity(ctx, {
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      meaning: parsed.data.meaning,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "signature.create",
      entityType: "signature",
      entityId: signature.id,
      metadata: {
        entity_type: signature.entity_type,
        entity_id: signature.entity_id,
        meaning: signature.meaning,
      },
    });

    return created(signature);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't record the signature. Please try again.", 500);
  }
});
