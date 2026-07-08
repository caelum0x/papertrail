import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { deleteDocument, getDocument } from "@/lib/documents/repository";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents/[id] — full document detail (metadata + extracted text).
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "viewer");
      const id = params?.id;
      if (!id || !uuidRe.test(id)) {
        return fail("Invalid document id.", 400);
      }

      const doc = await getDocument(getPool(), ctx.org.id, id);
      if (!doc) {
        return fail("Document not found.", 404);
      }
      return ok(doc);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (typeof status === "number") {
        return fail((err as Error).message, status);
      }
      return fail("Failed to load document.", 500);
    }
  }
);

// DELETE /api/documents/[id] — remove a document (cascades to pages).
export const DELETE = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "editor");
      const id = params?.id;
      if (!id || !uuidRe.test(id)) {
        return fail("Invalid document id.", 400);
      }

      const pool = getPool();
      const removed = await deleteDocument(pool, ctx.org.id, id);
      if (!removed) {
        return fail("Document not found.", 404);
      }

      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "document.delete",
        entityType: "document",
        entityId: id,
      });

      return ok({ deleted: true });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (typeof status === "number") {
        return fail((err as Error).message, status);
      }
      return fail("Failed to delete document.", 500);
    }
  }
);
