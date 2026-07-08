import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateReferenceSchema } from "@/lib/references/types";
import {
  getReference,
  updateReference,
  deleteReference,
} from "@/lib/references/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/references/[id] — edit a reference's bibliographic fields. Editor+.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid reference id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = updateReferenceSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getReference(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Reference not found.", 404);
    }

    const updated = await updateReference(pool, ctx.org.id, id, {
      type: parsed.data.type,
      title: parsed.data.title,
      authors: parsed.data.authors,
      year: parsed.data.year,
      journal: parsed.data.journal,
      doi: parsed.data.doi,
      pmid: parsed.data.pmid,
      nctId: parsed.data.nctId,
      url: parsed.data.url,
    });
    if (!updated) {
      return fail("Reference not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "reference.update",
      entityType: "reference",
      entityId: id,
      metadata: { libraryId: updated.libraryId },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update reference.", 500);
  }
});

// DELETE /api/references/[id] — remove a reference. Editor+. Audited.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid reference id.", 400);
    }

    const pool = getPool();
    const existing = await getReference(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Reference not found.", 404);
    }

    const removed = await deleteReference(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Reference not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "reference.delete",
      entityType: "reference",
      entityId: id,
      metadata: { libraryId: existing.libraryId },
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete reference.", 500);
  }
});
