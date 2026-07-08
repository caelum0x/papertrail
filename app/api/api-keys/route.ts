import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { countApiKeys, listApiKeys, insertApiKey } from "@/lib/admin-audit/repository";
import { generateApiKey } from "@/lib/admin-audit/apiKeys";
import { createApiKeySchema } from "@/lib/admin-audit/schemas";
import type { ApiKeySummary, ApiKeyCreated } from "@/lib/admin-audit/types";

export const runtime = "nodejs";

// GET /api/api-keys — paginated list of the org's API keys (never the secret).
// Admin+ only.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, keys] = await Promise.all([
      countApiKeys(pool, ctx.org.id),
      listApiKeys(pool, ctx.org.id, limit, offset),
    ]);
    return ok<ApiKeySummary[]>(keys, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load API keys.", 500);
  }
});

// POST /api/api-keys — mint a new key. The raw secret is returned exactly once
// in the response and never stored or logged. Admin+ only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = createApiKeySchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const generated = generateApiKey();
    const summary = await insertApiKey(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name,
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
      createdBy: ctx.user.id,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "api_key.create",
      entityType: "api_key",
      entityId: summary.id,
      // Never log the secret — only the non-sensitive name & prefix.
      metadata: { name: summary.name, keyPrefix: summary.keyPrefix },
    });

    const response: ApiKeyCreated = {
      ...summary,
      createdByName: ctx.user.name,
      key: generated.key,
    };
    return created<ApiKeyCreated>(response);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create API key.", 500);
  }
});
