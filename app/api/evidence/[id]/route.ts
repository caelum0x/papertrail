import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { updateEvidenceSchema } from "@/lib/evidence/schemas";
import {
  getEvidenceById,
  updateEvidence,
  deleteEvidence,
} from "@/lib/evidence/repo";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

function rbacStatus(err: unknown): number | null {
  if (err instanceof Error && typeof (err as unknown as { status?: unknown }).status === "number") {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// GET /api/evidence/[id] — org-scoped detail.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      const parsed = idSchema.safeParse(params?.id);
      if (!parsed.success) {
        return fail("Invalid evidence id.", 400);
      }
      const item = await getEvidenceById(ctx.org.id, parsed.data);
      if (!item) {
        return fail("Evidence item not found.", 404);
      }
      return ok(item);
    } catch {
      return fail("Couldn't load this evidence item. Please try again.", 500);
    }
  }
);

// PATCH /api/evidence/[id] — update mutable fields.
export const PATCH = withOrg(
  async (req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "editor");

      const parsedId = idSchema.safeParse(params?.id);
      if (!parsedId.success) {
        return fail("Invalid evidence id.", 400);
      }

      const body = await req.json().catch(() => null);
      const parsed = updateEvidenceSchema.safeParse(body);
      if (!parsed.success) {
        return fail(parsed.error.issues[0]?.message ?? "Invalid update.", 400);
      }

      const updated = await updateEvidence(ctx.org.id, parsedId.data, parsed.data);
      if (!updated) {
        return fail("Evidence item not found.", 404);
      }

      await writeAudit(getPool(), {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "evidence.update",
        entityType: "evidence_item",
        entityId: updated.id,
        metadata: { fields: Object.keys(parsed.data) },
      });

      return ok(updated);
    } catch (err: unknown) {
      const status = rbacStatus(err);
      if (status !== null) {
        return fail((err as Error).message, status);
      }
      return fail("Couldn't update this evidence item. Please try again.", 500);
    }
  }
);

// DELETE /api/evidence/[id] — remove from the library.
export const DELETE = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "editor");

      const parsed = idSchema.safeParse(params?.id);
      if (!parsed.success) {
        return fail("Invalid evidence id.", 400);
      }

      const removed = await deleteEvidence(ctx.org.id, parsed.data);
      if (!removed) {
        return fail("Evidence item not found.", 404);
      }

      await writeAudit(getPool(), {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "evidence.delete",
        entityType: "evidence_item",
        entityId: parsed.data,
      });

      return ok({ id: parsed.data, deleted: true });
    } catch (err: unknown) {
      const status = rbacStatus(err);
      if (status !== null) {
        return fail((err as Error).message, status);
      }
      return fail("Couldn't delete this evidence item. Please try again.", 500);
    }
  }
);
