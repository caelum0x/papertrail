import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { commitImportSchema, TARGET_FIELDS } from "@/lib/import/types";
import { getBatch, commitBatch, isOrgLibrary } from "@/lib/import/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/imports/[id]/commit — apply the batch's mapping and insert the staged
// rows into the target table (editor+). Per-row success/failure is recorded; an
// already-committed batch is rejected. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid import batch id.", 400);
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = commitImportSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const batch = await getBatch(pool, ctx.org.id, id);
    if (!batch) {
      return fail("Import batch not found.", 404);
    }
    if (batch.status === "committed") {
      return fail("This batch has already been committed.", 409);
    }

    // Resolve the effective mapping: caller override wins, else the stored one.
    const storedMapping = batch.mapping ?? {};
    const effectiveMapping = { ...storedMapping, ...(parsed.data.mapping ?? {}) };

    // Required target fields must be mapped before commit.
    const requiredKeys = TARGET_FIELDS[batch.target]
      .filter((f) => f.required)
      .map((f) => f.key);
    const missing = requiredKeys.filter((k) => !effectiveMapping[k]);
    if (missing.length > 0) {
      return fail(`Map required field(s): ${missing.join(", ")}.`, 400);
    }

    // For references, resolve the destination library (override, else stored on
    // the batch mapping as __libraryId).
    let libraryId: string | null = null;
    if (batch.target === "references") {
      libraryId =
        parsed.data.libraryId ??
        (typeof storedMapping.__libraryId === "string"
          ? storedMapping.__libraryId
          : null);
      if (!libraryId) {
        return fail("A target reference library is required.", 400);
      }
      const owned = await isOrgLibrary(pool, ctx.org.id, libraryId);
      if (!owned) {
        return fail("Reference library not found.", 404);
      }
    }

    // Strip the internal marker before it reaches the row mapper.
    const commitMapping = { ...effectiveMapping };
    delete commitMapping.__libraryId;

    const result = await commitBatch(pool, {
      orgId: ctx.org.id,
      batchId: id,
      createdBy: ctx.user.id,
      mapping: commitMapping,
      target: batch.target,
      libraryId,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "import.commit",
      entityType: "import_batch",
      entityId: id,
      metadata: {
        target: batch.target,
        succeeded: result.succeeded,
        failed: result.failed,
      },
    });

    return ok(result.batch);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to commit import batch.", 500);
  }
});
