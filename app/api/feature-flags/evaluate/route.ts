import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { evaluateQuerySchema } from "@/lib/flags/schemas";
import { getFlagByKey } from "@/lib/flags/repository";
import { evaluateFlag } from "@/lib/flags/evaluate";
import type { FlagEvaluation } from "@/lib/flags/types";

export const runtime = "nodejs";

// GET /api/feature-flags/evaluate?key=&subject= — resolve a flag for a subject.
// Deterministic (no randomness): the same key+subject always returns the same
// result. Read-only; any member (viewer+) may evaluate. Attribute-based rules
// may be supplied as extra query params (?plan=pro&country=US).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const url = new URL(req.url);
    const parsed = evaluateQuerySchema.safeParse({
      key: url.searchParams.get("key") ?? undefined,
      subject: url.searchParams.get("subject") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    // Collect any additional query params as targeting attributes.
    const attributes: Record<string, string> = {};
    url.searchParams.forEach((value, name) => {
      if (name !== "key" && name !== "subject") {
        attributes[name] = value;
      }
    });

    const flag = await getFlagByKey(getPool(), ctx.org.id, parsed.data.key);
    if (!flag) {
      const result: FlagEvaluation = {
        key: parsed.data.key,
        subjectId: parsed.data.subject,
        enabled: false,
        reason: "flag_not_found",
      };
      return ok<FlagEvaluation>(result);
    }

    const result = evaluateFlag(flag, parsed.data.subject, attributes);
    return ok<FlagEvaluation>(result);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to evaluate feature flag.", 500);
  }
});
