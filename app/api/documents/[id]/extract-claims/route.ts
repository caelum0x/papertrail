import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { documentExists } from "@/lib/ingestion/pipeline";
import {
  extractClaimsFromText,
  replaceLlmClaims,
} from "@/lib/ingestion/claimExtraction";
import { getDocumentText } from "@/lib/documents/repository";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/documents/[id]/extract-claims — run Claude over the document's text to
// pull candidate verifiable claims, persist them, and return the fresh set.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !uuidRe.test(id)) {
      return fail("Invalid document id.", 400);
    }

    const pool = getPool();
    if (!(await documentExists(pool, ctx.org.id, id))) {
      return fail("Document not found.", 404);
    }

    const text = await getDocumentText(pool, ctx.org.id, id);
    const fullText = text?.extracted_text ?? "";
    if (fullText.trim().length === 0) {
      return fail(
        "This document has no extracted text. Run extraction first.",
        400
      );
    }

    const candidates = await extractClaimsFromText(fullText);
    const claims = await replaceLlmClaims(pool, ctx.org.id, id, candidates);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "document.extract_claims",
      entityType: "document",
      entityId: id,
      metadata: { count: claims.length },
    });

    return ok(claims, { total: claims.length });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to extract claims.", 500);
  }
});
