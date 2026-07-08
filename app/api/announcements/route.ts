import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole, hasRoleAtLeast } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  createAnnouncementSchema,
  ANNOUNCEMENT_KINDS,
  type AnnouncementKind,
} from "@/lib/announcements/types";
import {
  listAnnouncements,
  countAnnouncements,
  createAnnouncement,
  type AnnouncementFilters,
} from "@/lib/announcements/queries";

// GET /api/announcements — paginated, org-scoped list joined to the caller's
// read state. Admins see drafts + published; non-admins see published only.
// Optional ?kind and ?search filters. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const kindParam = url.searchParams.get("kind") ?? undefined;
    if (kindParam && !ANNOUNCEMENT_KINDS.includes(kindParam as AnnouncementKind)) {
      return fail("Invalid kind.", 400);
    }
    const search = url.searchParams.get("search")?.trim() || undefined;

    // Non-admins can never see drafts. Admins may opt into published-only via
    // ?published=1 (e.g. previewing the member feed) but default to seeing all.
    const isAdmin = hasRoleAtLeast(ctx.role, "admin");
    const publishedParam = url.searchParams.get("published");
    const publishedOnly = !isAdmin || publishedParam === "1";

    const filters: AnnouncementFilters = {
      kind: kindParam as AnnouncementKind | undefined,
      search,
      publishedOnly,
    };

    const pool = getPool();
    const [items, total] = await Promise.all([
      listAnnouncements(pool, ctx.org.id, ctx.user.id, filters, limit, offset),
      countAnnouncements(pool, ctx.org.id, filters),
    ]);
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load announcements.", 500);
  }
});

// POST /api/announcements — create an announcement (admin+). Created as a draft
// unless publish=true. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const raw = await req.json().catch(() => null);
    const parsed = createAnnouncementSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const publish = parsed.data.publish ?? false;
    const announcement = await createAnnouncement(pool, {
      orgId: ctx.org.id,
      title: parsed.data.title,
      body: parsed.data.body,
      kind: parsed.data.kind ?? "general",
      audience: parsed.data.audience ?? "all",
      createdBy: ctx.user.id,
      publish,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: publish ? "announcement.publish" : "announcement.create",
      entityType: "announcement",
      entityId: announcement.id,
      metadata: { title: announcement.title, kind: announcement.kind, publish },
    });

    return created(announcement);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create announcement.", 500);
  }
});
