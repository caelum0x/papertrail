import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { callTool, isBuiltinTool } from "@/lib/tools/registry";
import { insertToolCall } from "@/lib/tools/repository";
import type { ToolCall } from "@/lib/tools/types";

export const runtime = "nodejs";

// Redact obviously large/free-text inputs before persisting them to tool_calls so
// the call log stays readable and doesn't store multi-KB claim passages verbatim.
function redactInput(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { value: input };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 500)}… (${value.length} chars)`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

// POST /api/tools/[name]/call — execute a tool and record the invocation. Running
// a tool exercises the verification pipeline (Claude + embeddings), so it requires
// editor+ (matching the "verify" capability). Org-scoped; the call is logged to
// tool_calls and audited. Input validation happens inside callTool().
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const name = params?.name;
    if (!name) return fail("Tool name is required.", 400);

    // Only built-in tools are executable today; registered tools are declarations
    // used by the manifest/catalog. Reject unknown/registered names cleanly.
    if (!isBuiltinTool(name)) {
      return fail(`Tool '${name}' is not executable.`, 404);
    }

    const json = await req.json().catch(() => null);
    const input = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;

    const result = await callTool(name, input, ctx);

    // Persistence is best-effort: the caller has already paid for the execution,
    // so a DB hiccup must not discard the result or 500 the request.
    const pool = getPool();
    let recorded: ToolCall | null = null;
    try {
      recorded = await insertToolCall(pool, {
        orgId: ctx.org.id,
        toolName: name,
        input: redactInput(input),
        output: result.ok ? result.output : { error: result.error },
        status: result.ok ? "success" : "error",
        durationMs: result.durationMs,
      });
    } catch (persistErr) {
      console.error("[/api/tools/call] failed to record tool_call:", persistErr);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "tool.call",
      entityType: "tool_call",
      entityId: recorded?.id ?? null,
      metadata: {
        tool: name,
        status: result.ok ? "success" : "error",
        durationMs: result.durationMs,
      },
    });

    if (!result.ok) {
      return fail(result.error ?? "Tool execution failed.", 400);
    }

    return ok<{ tool: string; output: unknown; durationMs: number; callId: string | null }>({
      tool: name,
      output: result.output,
      durationMs: result.durationMs,
      callId: recorded?.id ?? null,
    });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to execute tool.", 500);
  }
});
