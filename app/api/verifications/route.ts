import { NextRequest, NextResponse } from "next/server";
import { listVerifications } from "@/lib/queries/verifications";
import { parsePagination } from "@/lib/queries/pagination";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const start = Date.now();

  try {
    const { searchParams } = new URL(req.url);
    const { limit, offset } = parsePagination(searchParams, { defaultLimit: 20 });
    const discrepancyTypeRaw = searchParams.get("discrepancy_type");
    const discrepancyType = discrepancyTypeRaw ? discrepancyTypeRaw : undefined;

    const { items, total } = await listVerifications({
      limit,
      offset,
      discrepancyType,
    });

    logEvent("verifications.list", {
      count: items.length,
      total,
      limit,
      offset,
      filtered: discrepancyType !== undefined,
      latencyMs: Date.now() - start,
    });

    return NextResponse.json({ items, total });
  } catch {
    logEvent("verifications.list_error", { latencyMs: Date.now() - start });
    return NextResponse.json(
      { error: "Couldn't load recent verifications. Please try again shortly." },
      { status: 500 }
    );
  }
}
