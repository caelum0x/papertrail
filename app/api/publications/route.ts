import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createPublicationSchema, PUBLICATION_STATUSES } from "./lib/schemas";
import { listPublications, createPublication } from "./lib/repository";
import type { PublicationStatus } from "./lib/types";

function parseStatus(value: string | null): PublicationStatus | undefined {
  if (value && (PUBLICATION_STATUSES as readonly string[]).includes(value)) {
    return value as PublicationStatus;
  }
  return undefined;
}

// GET /api/publications — list publications for the org. Any member reads.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const status = parseStatus(url.searchParams.get("status"));
    const { limit, offset, page } = parsePagination(req);

    const { items, total } = await listPublications(getPool(), {
      orgId: ctx.org.id,
      status,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load publications.", 500);
  }
});

// POST /api/publications — start planning a new publication. Editors and above.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = createPublicationSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const publication = await createPublication(pool, {
      orgId: ctx.org.id,
      projectId: parsed.data.projectId ?? null,
      title: parsed.data.title,
      type: parsed.data.type,
      targetJournal: parsed.data.targetJournal ?? null,
      createdBy: ctx.user.id,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "publication.created",
      entityType: "publication",
      entityId: publication.id,
      metadata: { title: publication.title, type: publication.type },
    });

    return created(publication);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create publication.", 500);
  }
});
