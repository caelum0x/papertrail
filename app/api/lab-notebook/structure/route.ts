import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { StructureInputSchema } from "@/lib/labNotebook/schemas";
import { structureExperiment } from "@/lib/labNotebook/structure";

export const runtime = "nodejs";

// POST /api/lab-notebook/structure — turn a scientist's rough bench notes into a
// structured, grounded experiment record (NOT saved). Editor+. The response includes
// droppedUngrounded: how many quoted items Claude produced that couldn't be located in
// the notes and were discarded. NEVER logs the raw notes — only counts.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  requireRole(ctx, "editor");

  const body = await req.json().catch(() => null);
  const parsed = StructureInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Provide bench notes (1–20000 characters).",
      400
    );
  }

  try {
    const { structured, droppedUngrounded } = await structureExperiment(
      parsed.data.notes
    );
    return ok({ structured, droppedUngrounded });
  } catch (err) {
    console.error("[/api/lab-notebook/structure] failed:", err);
    return fail(
      "Couldn't structure these notes right now. This has been logged — please try again.",
      500
    );
  }
});
