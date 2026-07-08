import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createReleaseSchema } from "@/lib/announcements/types";
import {
  listReleases,
  countReleases,
  createRelease,
  findReleaseByVersion,
} from "@/lib/announcements/queries";

// GET /api/releases — paginated, org-scoped changelog timeline, newest first.
// Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);

    const pool = getPool();
    const [items, total] = await Promise.all([
      listReleases(pool, ctx.org.id, limit, offset),
      countReleases(pool, ctx.org.id),
    ]);
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load releases.", 500);
  }
});

// POST /api/releases — publish a release / changelog entry (admin+). Enforces
// per-org unique version. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const raw = await req.json().catch(() => null);
    const parsed = createReleaseSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const duplicate = await findReleaseByVersion(
      pool,
      ctx.org.id,
      parsed.data.version
    );
    if (duplicate) {
      return fail("A release with this version already exists.", 409);
    }

    const release = await createRelease(pool, {
      orgId: ctx.org.id,
      version: parsed.data.version,
      notes: parsed.data.notes ?? "",
      releasedAt: parsed.data.releasedAt ?? null,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "release.create",
      entityType: "release",
      entityId: release.id,
      metadata: { version: release.version },
    });

    return created(release);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create release.", 500);
  }
});
