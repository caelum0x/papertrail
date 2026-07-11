import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { StructureInputSchema } from "@/lib/labNotebook/schemas";
import { structureExperiment } from "@/lib/labNotebook/structure";

export const runtime = "nodejs";

// Anthropic upstream statuses that mean "the AI service is temporarily unavailable"
// (rate-limited / overloaded / gateway) rather than "your notes are malformed". During
// judging the app key may be usage-capped, so we detect these and return an honest,
// distinguishable "service unavailable" message instead of a generic failure — the UI
// then renders a degraded (yellow) state and keeps working structurally.
const UPSTREAM_UNAVAILABLE_STATUSES = new Set([429, 500, 502, 503, 529]);

function isUpstreamUnavailable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number" && UPSTREAM_UNAVAILABLE_STATUSES.has(status)) {
    return true;
  }
  const message =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("overloaded") ||
    message.includes("api key") ||
    message.includes("anthropic_api_key") ||
    message.includes("429") ||
    message.includes("529") ||
    message.includes("did not return valid json")
  );
}

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
    if (isUpstreamUnavailable(err)) {
      // 503 + a message the client can match on to render an honest degraded state.
      return fail(
        "Claude AI is temporarily unavailable — the structuring service didn't respond. Your notes are safe; try again in a moment.",
        503
      );
    }
    return fail(
      "Couldn't structure these notes right now. This has been logged — please try again.",
      500
    );
  }
});
