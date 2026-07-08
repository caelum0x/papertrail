import { NextResponse } from "next/server";
import { z } from "zod";
import { getSourceWithVerifications } from "@/lib/queries/sources";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

const IdSchema = z.string().uuid();

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const start = Date.now();

  const parsed = IdSchema.safeParse(params.id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid source id." }, { status: 400 });
  }
  const id = parsed.data;

  try {
    const result = await getSourceWithVerifications(id);

    if (!result) {
      logEvent("sources.detail_not_found", { latencyMs: Date.now() - start });
      return NextResponse.json({ error: "Source not found." }, { status: 404 });
    }

    logEvent("sources.detail", {
      verificationCount: result.verifications.length,
      latencyMs: Date.now() - start,
    });

    return NextResponse.json({
      source: result.source,
      verifications: result.verifications,
    });
  } catch {
    logEvent("sources.detail_error", { latencyMs: Date.now() - start });
    return NextResponse.json(
      { error: "Couldn't load this source. Please try again shortly." },
      { status: 500 }
    );
  }
}
