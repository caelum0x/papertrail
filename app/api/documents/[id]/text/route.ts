import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { getDocumentText } from "@/lib/documents/repository";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents/[id]/text — extracted text plus page-by-page breakdown.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "viewer");
      const id = params?.id;
      if (!id || !uuidRe.test(id)) {
        return fail("Invalid document id.", 400);
      }

      const result = await getDocumentText(getPool(), ctx.org.id, id);
      if (!result) {
        return fail("Document not found.", 404);
      }
      return ok(result);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (typeof status === "number") {
        return fail((err as Error).message, status);
      }
      return fail("Failed to load document text.", 500);
    }
  }
);
