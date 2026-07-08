import { NextRequest, NextResponse } from "next/server";
import { listSources } from "@/lib/queries/sources";
import { parsePagination } from "@/lib/queries/pagination";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const start = Date.now();

  try {
    const { searchParams } = new URL(req.url);
    const { limit, offset } = parsePagination(searchParams, { defaultLimit: 50 });
    const qRaw = searchParams.get("q");
    const q = qRaw && qRaw.trim().length > 0 ? qRaw.trim() : undefined;

    const { items, total } = await listSources({ limit, offset, q });

    logEvent("sources.list", {
      count: items.length,
      total,
      limit,
      offset,
      searched: q !== undefined,
      latencyMs: Date.now() - start,
    });

    return NextResponse.json({ items, total });
  } catch {
    logEvent("sources.list_error", { latencyMs: Date.now() - start });
    return NextResponse.json(
      { error: "Couldn't load cached sources. Please try again shortly." },
      { status: 500 }
    );
  }
}
