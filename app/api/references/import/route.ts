import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { importSchema } from "@/lib/references/types";
import { parseReferences } from "@/lib/references/formats";
import { getLibrary, bulkCreateReferences } from "@/lib/references/queries";

export const runtime = "nodejs";

// POST /api/references/import — parse a BibTeX/RIS document into the given library
// and bulk-insert the resulting references (editor+). Returns the imported count.
// Audited. Never trusts the raw file: parsing is forgiving and each field is
// bounded by the reference schema at write time via structured columns.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = importSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const library = await getLibrary(pool, ctx.org.id, parsed.data.libraryId);
    if (!library) {
      return fail("Reference library not found.", 404);
    }

    const references = parseReferences(parsed.data.format, parsed.data.text);
    if (references.length === 0) {
      return fail(
        `No valid ${parsed.data.format.toUpperCase()} references found in the provided text.`,
        400
      );
    }

    const imported = await bulkCreateReferences(pool, {
      orgId: ctx.org.id,
      libraryId: parsed.data.libraryId,
      references,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "reference.import",
      entityType: "reference_library",
      entityId: parsed.data.libraryId,
      metadata: { format: parsed.data.format, imported },
    });

    return created({ libraryId: parsed.data.libraryId, imported });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to import references.", 500);
  }
});
