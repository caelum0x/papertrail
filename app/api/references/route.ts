import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createReferenceSchema } from "@/lib/references/types";
import {
  listReferences,
  countReferences,
  createReference,
  getLibrary,
} from "@/lib/references/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/references — paginated, org-scoped list. Optional ?libraryId & ?search
// (title ILIKE) filters. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const libraryId = url.searchParams.get("libraryId") ?? undefined;
    if (libraryId && !UUID_RE.test(libraryId)) {
      return fail("Invalid library id.", 400);
    }
    const search = url.searchParams.get("search")?.trim() || undefined;
    const filters = { libraryId, search };

    const pool = getPool();
    const [references, total] = await Promise.all([
      listReferences(pool, ctx.org.id, filters, limit, offset),
      countReferences(pool, ctx.org.id, filters),
    ]);
    return ok(references, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load references.", 500);
  }
});

// POST /api/references — add a single reference to a library (editor+). Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createReferenceSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const library = await getLibrary(pool, ctx.org.id, parsed.data.libraryId);
    if (!library) {
      return fail("Reference library not found.", 404);
    }

    const reference = await createReference(pool, {
      orgId: ctx.org.id,
      libraryId: parsed.data.libraryId,
      type: parsed.data.type,
      title: parsed.data.title ?? null,
      authors: parsed.data.authors,
      year: parsed.data.year ?? null,
      journal: parsed.data.journal ?? null,
      doi: parsed.data.doi ?? null,
      pmid: parsed.data.pmid ?? null,
      nctId: parsed.data.nctId ?? null,
      url: parsed.data.url ?? null,
      raw: parsed.data.raw ?? {},
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "reference.create",
      entityType: "reference",
      entityId: reference.id,
      metadata: { libraryId: reference.libraryId, title: reference.title },
    });

    return created(reference);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create reference.", 500);
  }
});
