import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { splitIntoClaims } from "@/lib/claimSplitter";
import { logEvent } from "@/lib/logger";
import { runBatch } from "@/lib/agents/batchAgent";
import { BatchResultItem } from "@/components/BatchResults";
import { sanitizeClaimText } from "@/lib/api/claimInput";

export const runtime = "nodejs";

// HARD CAP: never process more than this many claims in a single batch, regardless
// of how many the splitter detects. Batch runs SEQUENTIALLY (see runBatch), so this
// directly bounds the worst-case token spend of one request to 5 full agent chains.
const MAX_BATCH = 5;

export interface BatchResponse {
  batch_id: string;
  results: BatchResultItem[];
  truncated: boolean;
  total_detected: number;
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("batch.rate_limited", { ip });
    return NextResponse.json(
      { error: "Rate limit reached. Please try again shortly." },
      { status: 429 }
    );
  }

  let body: { text?: string; claims?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Build the candidate claim list: explicit claims[] wins; otherwise split the passage.
  const candidateClaims = Array.isArray(body.claims)
    ? body.claims.map((c) => (typeof c === "string" ? c.trim() : "")).filter((c) => c.length > 0)
    : splitIntoClaims(body.text ?? "");

  // Character-quality hardening: drop any candidate with control chars / invisible
  // smuggling / degenerate repetition before it reaches the agent chain. Returns the
  // cleaned string for the survivors. Invalid candidates are silently skipped (same
  // spirit as filtering empties above) rather than failing the whole batch.
  const rawClaims = candidateClaims
    .map((c) => sanitizeClaimText(c))
    .filter((r): r is { ok: true; value: string } => r.ok)
    .map((r) => r.value);

  if (rawClaims.length === 0) {
    return NextResponse.json(
      { error: "No claims detected. Paste a passage or provide a non-empty claims list." },
      { status: 400 }
    );
  }

  const totalDetected = rawClaims.length;
  const truncated = totalDetected > MAX_BATCH;
  // Enforce the hard cap: only the first MAX_BATCH claims are ever processed.
  const claims = rawClaims.slice(0, MAX_BATCH);

  try {
    // Delegate the sequential agent-chain loop + persistence to the batch agent.
    const { batch_id, results } = await runBatch(claims);

    logEvent("batch.success", {
      latencyMs: Date.now() - start,
      batch_id,
      totalDetected,
      processed: results.length,
      truncated,
      verified: results.filter((r) => r.status === "verified").length,
      noSupport: results.filter((r) => r.status === "no_support_found").length,
      errors: results.filter((r) => r.status === "error").length,
    });

    const response: BatchResponse = {
      batch_id,
      results,
      truncated,
      total_detected: totalDetected,
    };
    return NextResponse.json(response);
  } catch (err) {
    logEvent("batch.error", { error: String(err), latencyMs: Date.now() - start });
    console.error("[/api/verify/batch] batch run failed:", err);
    return NextResponse.json(
      { error: "Something went wrong running the batch. Please try again." },
      { status: 500 }
    );
  }
}
