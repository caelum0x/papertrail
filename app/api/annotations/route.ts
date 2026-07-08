import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  listAnnotationsQuerySchema,
  createAnnotationSchema,
  listAnnotations,
  createAnnotation,
  documentInOrg,
  recordActivity,
  extractMentions,
  type Annotation,
} from "../comments/shared";

export const runtime = "nodejs";

// GET /api/annotations?document_id — all highlight+note annotations on a
// document, ordered by page. Any member (viewer+) may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const parsed = listAnnotationsQuerySchema.safeParse({
      document_id: url.searchParams.get("document_id") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const annotations = await listAnnotations(
      getPool(),
      ctx.org.id,
      parsed.data.document_id
    );
    return ok<Annotation[]>(annotations);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load annotations.", 500);
  }
});

// POST /api/annotations — anchor a quote + note to a document page. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = createAnnotationSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "Invalid request body.",
        400
      );
    }

    const pool = getPool();
    if (!(await documentInOrg(pool, ctx.org.id, parsed.data.documentId))) {
      return fail("Document not found in this organization.", 400);
    }

    const note = parsed.data.note ?? null;
    const annotation = await createAnnotation(pool, {
      orgId: ctx.org.id,
      documentId: parsed.data.documentId,
      pageNumber: parsed.data.pageNumber,
      quote: parsed.data.quote,
      note,
      authorId: ctx.user.id,
    });

    const mentions = note ? extractMentions(note) : [];

    await recordActivity(pool, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      verb: "annotated",
      entityType: "document",
      entityId: annotation.documentId,
      metadata: {
        annotationId: annotation.id,
        pageNumber: annotation.pageNumber,
        mentions,
      },
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "annotation.created",
      entityType: "annotation",
      entityId: annotation.id,
      metadata: {
        documentId: annotation.documentId,
        pageNumber: annotation.pageNumber,
        mentions,
      },
    });

    return created(annotation);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create annotation.", 500);
  }
});
