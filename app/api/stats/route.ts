import { NextResponse } from "next/server";
import { getAggregateStats, AggregateStats } from "@/lib/queries/stats";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

// Response contract is unchanged — same shape the route previously computed inline.
export type StatsResponse = AggregateStats;

export async function GET() {
  const start = Date.now();

  try {
    const body = await getAggregateStats();

    logEvent("stats.read", {
      totalVerifications: body.total_verifications,
      totalSources: body.total_sources,
      latencyMs: Date.now() - start,
    });

    return NextResponse.json(body);
  } catch {
    logEvent("stats.read_error", { latencyMs: Date.now() - start });
    return NextResponse.json(
      { error: "Couldn't load stats. Please try again shortly." },
      { status: 500 }
    );
  }
}
