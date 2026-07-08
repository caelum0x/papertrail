import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createImportSchema } from "@/lib/import/types";
import { parseImport } from "@/lib/import/parse";
import {
  createBatch,
  listBatches,
  countBatches,
  isOrgLibrary,
} from "@/lib/import/queries";

// GET /api/imports — paginated, org-scoped list of import batches. Any member may
// read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();
    const [batches, total] = await Promise.all([
      listBatches(pool, ctx.org.id, limit, offset),
      countBatches(pool, ctx.org.id),
    ]);
    return ok(batches, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load import batches.", 500);
  }
});

// POST /api/imports — parse pasted CSV/BibTeX/RIS text into a staged batch of
// rows for a target table (editor+). Does NOT insert into the target yet — that
// happens at commit time so the user can review the mapping and preview first.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createImportSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const input = parsed.data;

    // References must land in an existing, org-owned library.
    if (input.target === "references") {
      if (!input.libraryId) {
        return fail("A target reference library is required for references.", 400);
      }
      const pool = getPool();
      const owned = await isOrgLibrary(pool, ctx.org.id, input.libraryId);
      if (!owned) {
        return fail("Reference library not found.", 404);
      }
    }

    const table = parseImport(input.format, input.text);
    if (table.rows.length === 0) {
      return fail("No rows found in the provided file.", 400);
    }

    // References store their target library on the batch mapping so commit knows
    // where to write without another round trip.
    const mapping =
      input.target === "references" && input.libraryId
        ? { ...input.mapping, __libraryId: input.libraryId }
        : input.mapping;

    const pool = getPool();
    const batch = await createBatch(pool, {
      orgId: ctx.org.id,
      createdBy: ctx.user.id,
      target: input.target,
      format: input.format,
      mapping,
      rows: table.rows,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "import.create",
      entityType: "import_batch",
      entityId: batch.id,
      metadata: { target: batch.target, format: batch.format, total: batch.total },
    });

    return created(batch);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create import batch.", 500);
  }
});
