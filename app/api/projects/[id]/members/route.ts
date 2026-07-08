import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { addMemberSchema } from "@/lib/projects/types";
import {
  getProject,
  listMembers,
  addMember,
  isOrgMember,
} from "@/lib/projects/queries";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// GET /api/projects/[id]/members — members of a project, org-scoped.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      const id = params?.id;
      if (!id) return fail("Project id is required.", 400);

      const pool = getPool();
      const project = await getProject(pool, ctx.org.id, id);
      if (!project) return fail("Project not found.", 404);

      const members = await listMembers(pool, ctx.org.id, id);
      return ok(members, { total: members.length });
    } catch {
      return fail("Failed to load members.", 500);
    }
  }
);

// POST /api/projects/[id]/members — add/update a project member (admin+). Audited.
export const POST = withOrg(
  async (req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "admin");
      const id = params?.id;
      if (!id) return fail("Project id is required.", 400);

      const raw = await req.json().catch(() => null);
      const parsed = addMemberSchema.safeParse(raw);
      if (!parsed.success) {
        return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
      }

      const pool = getPool();
      const project = await getProject(pool, ctx.org.id, id);
      if (!project) return fail("Project not found.", 404);

      const inOrg = await isOrgMember(pool, ctx.org.id, parsed.data.userId);
      if (!inOrg) {
        return fail("User is not a member of this organization.", 400);
      }

      const member = await addMember(pool, {
        orgId: ctx.org.id,
        projectId: id,
        userId: parsed.data.userId,
        role: parsed.data.role,
      });
      if (!member) return fail("Failed to add member.", 500);

      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "project.member.add",
        entityType: "project",
        entityId: id,
        metadata: { userId: member.userId, role: member.role },
      });

      return created(member);
    } catch (err: unknown) {
      const s = statusOf(err);
      if (s) return fail((err as Error).message, s);
      return fail("Failed to add member.", 500);
    }
  }
);
