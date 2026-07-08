import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createDocumentSchema } from "@/lib/documents/schemas";
import { insertDocument, listDocuments } from "@/lib/documents/repository";

// GET /api/documents — paginated, org-scoped document library.
// Optional ?project_id filter.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const projectId = new URL(req.url).searchParams.get("project_id");

    const { documents, total } = await listDocuments(getPool(), ctx.org.id, {
      limit,
      offset,
      projectId: projectId || null,
    });

    return ok(documents, { total, page, limit });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to list documents.", 500);
  }
});

// POST /api/documents — create metadata for a document (no content yet).
// Status is 'pending' until an upload populates extracted_text.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = createDocumentSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const input = parsed.data;

    const doc = await insertDocument(getPool(), {
      orgId: ctx.org.id,
      filename: input.filename,
      mimeType: input.mime_type ?? "application/octet-stream",
      sizeBytes: input.size_bytes ?? 0,
      projectId: input.project_id ?? null,
      storageKey: input.storage_key ?? null,
      extractedText: null,
      status: "pending",
      uploadedBy: ctx.user.id,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "document.create",
      entityType: "document",
      entityId: doc.id,
      metadata: { filename: doc.filename },
    });

    return created(doc);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to create document.", 500);
  }
});
