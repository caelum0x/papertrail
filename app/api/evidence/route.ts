import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { createEvidenceSchema } from "@/lib/evidence/schemas";
import { EVIDENCE_SOURCE_TYPES, type EvidenceSourceType } from "@/lib/evidence/types";
import { listEvidence, createEvidence } from "@/lib/evidence/repo";

export const runtime = "nodejs";

function parseSourceType(value: string | null): EvidenceSourceType | undefined {
  if (value && (EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value)) {
    return value as EvidenceSourceType;
  }
  return undefined;
}

// GET /api/evidence — paginated, org-scoped list with search (q) and filters
// (type, tag, project_id).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);
    const qRaw = url.searchParams.get("q");
    const tagRaw = url.searchParams.get("tag");
    const projectRaw = url.searchParams.get("project_id");

    const { items, total } = await listEvidence({
      orgId: ctx.org.id,
      limit,
      offset,
      q: qRaw && qRaw.trim().length > 0 ? qRaw.trim() : undefined,
      sourceType: parseSourceType(url.searchParams.get("type")),
      tag: tagRaw && tagRaw.trim().length > 0 ? tagRaw.trim() : undefined,
      projectId:
        projectRaw && projectRaw.trim().length > 0 ? projectRaw.trim() : undefined,
    });

    return ok(items, { total, page, limit });
  } catch {
    return fail("Couldn't load the evidence library. Please try again.", 500);
  }
});

// POST /api/evidence — add a curated evidence item to the org's library.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createEvidenceSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "Invalid evidence item.",
        400
      );
    }

    const item = await createEvidence({
      ...parsed.data,
      orgId: ctx.org.id,
      addedBy: ctx.user.id,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "evidence.create",
      entityType: "evidence_item",
      entityId: item.id,
      metadata: { source_type: item.source_type, title: item.title },
    });

    return created(item);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as unknown as { status: number }).status);
    }
    return fail("Couldn't add the evidence item. Please try again.", 500);
  }
});
