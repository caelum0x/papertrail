import { NextResponse } from "next/server";
import { checkDbConnection } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const dbOk = await checkDbConnection().catch(() => false);
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasVoyageKey = Boolean(process.env.VOYAGE_API_KEY);

  const healthy = dbOk && hasAnthropicKey && hasVoyageKey;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database: dbOk,
        anthropic_key_present: hasAnthropicKey,
        voyage_key_present: hasVoyageKey,
      },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
