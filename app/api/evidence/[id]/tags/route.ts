import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { tagsSchema } from "@/lib/evidence/schemas";
import { addEvidenceTags } from "@/lib/evidence/repo";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

// POST /api/evidence/[id]/tags — merge new tags into an item's tag set.
export const POST = withOrg(
  async (req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "editor");

      const parsedId = idSchema.safeParse(params?.id);
      if (!parsedId.success) {
        return fail("Invalid evidence id.", 400);
      }

      const body = await req.json().catch(() => null);
      const parsed = tagsSchema.safeParse(body);
      if (!parsed.success) {
        return fail(parsed.error.issues[0]?.message ?? "Invalid tags.", 400);
      }

      const updated = await addEvidenceTags(
        ctx.org.id,
        parsedId.data,
        parsed.data.tags
      );
      if (!updated) {
        return fail("Evidence item not found.", 404);
      }

      await writeAudit(getPool(), {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "evidence.tag",
        entityType: "evidence_item",
        entityId: updated.id,
        metadata: { added: parsed.data.tags },
      });

      return ok(updated);
    } catch (err: unknown) {
      if (err instanceof Error && typeof (err as unknown as { status?: unknown }).status === "number") {
        return fail(err.message, (err as unknown as { status: number }).status);
      }
      return fail("Couldn't update tags. Please try again.", 500);
    }
  }
);
