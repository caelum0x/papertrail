import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  NetworkMetaRequestSchema,
  resolveEdge,
  bucherIndirect,
  combineDirectIndirect,
  type Contrast,
} from "@/lib/networkMeta";

// Public NETWORK / INDIRECT META-ANALYSIS endpoint (Bucher method). Given pooled
// A-vs-B and B-vs-C contrasts (each supplied directly or as studies to pool), it
// estimates the A-vs-C effect INDIRECTLY through the common comparator B; when a
// direct A-vs-C edge is also supplied it inverse-variance combines the two and
// reports the incoherence (inconsistency) test. No LLM anywhere in the numeric
// loop; every number is reproducible from the inputs. Never logs claim text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("network_meta.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = NetworkMetaRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid network-meta request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const { ab, bc, direct } = parsed.data;

  try {
    // Resolve each edge to a log-scale contrast (pooling studies when supplied).
    const abContrast = resolveEdge(ab);
    if ("reason" in abContrast) {
      return fail(`A-vs-B edge could not be built — ${abContrast.reason}`, 400);
    }
    const bcContrast = resolveEdge(bc);
    if ("reason" in bcContrast) {
      return fail(`B-vs-C edge could not be built — ${bcContrast.reason}`, 400);
    }

    const indirect = bucherIndirect(abContrast, bcContrast);

    // If a direct A-vs-C edge was supplied, combine it with the indirect estimate
    // and run the incoherence test.
    let combined = null;
    let directContrast: Contrast | null = null;
    if (direct) {
      const resolved = resolveEdge(direct);
      if ("reason" in resolved) {
        return fail(`Direct A-vs-C edge could not be built — ${resolved.reason}`, 400);
      }
      directContrast = resolved;
      combined = combineDirectIndirect(directContrast, {
        logEffect: indirect.logEffect,
        variance: indirect.variance,
      });
    }

    logEvent("network_meta.success", {
      latencyMs: Date.now() - start,
      indirectPoint: indirect.point,
      indirectSignificant: indirect.significant,
      hasDirect: directContrast !== null,
      inconsistent: combined?.incoherence.inconsistent ?? null,
    });

    return ok({
      ab: abContrast,
      bc: bcContrast,
      direct: directContrast,
      indirect,
      combined,
    });
  } catch (err) {
    logEvent("network_meta.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/network-meta] failed:", err);
    return fail(
      "Something went wrong while computing the network meta-analysis. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
