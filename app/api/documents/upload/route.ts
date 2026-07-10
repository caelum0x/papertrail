import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { uploadDocumentSchema } from "@/lib/documents/schemas";
import { insertDocument, insertPages } from "@/lib/documents/repository";
import type { DocumentStatus } from "@/lib/documents/types";
import { extractAnyDocument } from "@/lib/ingestion/extractAny";

// POST /api/documents/upload — accept raw text or a base64-encoded file in any of the
// accepted formats (PDF, DOCX, XLSX/XLS, CSV, Markdown, plain text). Bytes are routed
// to the right in-process extractor (lib/ingestion/extractAny); a plain `text` field
// is stored as-is. Stores the extracted text, splits into pages, sets status. File
// content is never logged.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = uploadDocumentSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const input = parsed.data;

    let extracted = "";
    let mimeType = input.mime_type ?? "text/plain";
    let sizeBytes = 0;

    if (typeof input.content_base64 === "string") {
      const buf = Buffer.from(input.content_base64, "base64");
      sizeBytes = buf.length;
      try {
        const doc = await extractAnyDocument({
          bytes: buf,
          filename: input.filename,
          mimeType: input.mime_type ?? null,
        });
        extracted = doc.text;
        mimeType =
          input.mime_type ??
          (doc.format === "pdf" ? "application/pdf" : mimeType);
      } catch {
        // Unknown/binary/corrupt input: store no text and let status fall to
        // "failed". Never surface or log the raw file bytes.
        extracted = "";
      }
    } else if (typeof input.text === "string") {
      extracted = input.text;
      sizeBytes = Buffer.byteLength(extracted, "utf-8");
    }

    const status: DocumentStatus =
      extracted.trim().length > 0 ? "extracted" : "failed";

    const pool = getPool();
    const doc = await insertDocument(pool, {
      orgId: ctx.org.id,
      filename: input.filename,
      mimeType,
      sizeBytes,
      projectId: input.project_id ?? null,
      storageKey: `inline:${Date.now()}`,
      extractedText: extracted.length > 0 ? extracted : null,
      status,
      uploadedBy: ctx.user.id,
    });

    let pageCount = 0;
    if (status === "extracted") {
      pageCount = await insertPages(pool, doc.id, extracted);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "document.upload",
      entityType: "document",
      entityId: doc.id,
      metadata: { filename: doc.filename, status, size_bytes: sizeBytes },
    });

    return created({ ...doc, page_count: pageCount });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to upload document.", 500);
  }
});
