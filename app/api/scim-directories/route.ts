import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createScimDirectorySchema } from "@/lib/sso/schemas";
import {
  countDirectories,
  listDirectories,
  insertDirectory,
  generateBearerToken,
  hashBearerToken,
} from "@/lib/sso/repository";
import type { ScimDirectory, ScimDirectoryWithToken } from "@/lib/sso/types";

export const runtime = "nodejs";

// GET /api/scim-directories — paginated list of the org's SCIM directories
// (bearer tokens never returned). Admin+ only, org-scoped.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, directories] = await Promise.all([
      countDirectories(pool, ctx.org.id),
      listDirectories(pool, ctx.org.id, limit, offset),
    ]);
    return ok<ScimDirectory[]>(directories, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load SCIM directories.", 500);
  }
});

// POST /api/scim-directories — provision a SCIM 2.0 endpoint. A high-entropy
// bearer token is generated server-side and returned exactly once (only its
// SHA-256 hash is stored). Admin+ only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => ({}));
    const parsed = createScimDirectorySchema.safeParse(json ?? {});
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const bearerToken = generateBearerToken();
    const pool = getPool();
    const directory = await insertDirectory(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name ?? "SCIM directory",
      bearerTokenHash: hashBearerToken(bearerToken),
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "scim_directory.create",
      entityType: "scim_directory",
      entityId: directory.id,
      // Never log the token — only the directory name.
      metadata: { name: directory.name },
    });

    // Token returned once, in the create response only.
    return created<ScimDirectoryWithToken>({ directory, bearerToken });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create SCIM directory.", 500);
  }
});
