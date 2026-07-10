import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { interactionSignal } from "@/lib/bio/ddi";
import { InteractionRequestSchema } from "@/lib/bio/ddi.schemas";

// Public POST endpoint for an open DRUG–DRUG-INTERACTION signal derived from
// FAERS (openFDA, CC0). Given { drugA, drugB, event } (e.g. { "warfarin",
// "fluconazole", "haemorrhage" }) it assembles, from spontaneous-report counts,
// the disproportionality (PRR / ROR / chi² / IC) for the event among reports
// listing BOTH drugs, contrasts it against each single-drug signal, and returns
// a DETERMINISTIC verdict: synergistic_signal | no_excess | insufficient_data.
//
// NO LLM is in the numeric path — every number is a closed-form statistic over
// open report counts, and the verdict comes from documented thresholds only.
// This deliberately avoids DrugBank / DDInter (paid / non-commercial). It is a
// hypothesis-generating screen, never proof of a causal interaction.
//
// On upstream failure the engine returns honest-null blocks with an
// insufficient_data verdict rather than a fabricated interaction.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.drug_interaction.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request. Surface the first
  // validation issue as a user-facing message rather than a raw Zod dump. We
  // never log the claim/drug/event text itself.
  const parsed = InteractionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid drug-interaction request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  try {
    const { drugA, drugB, event } = parsed.data;

    // Deterministic FAERS-derived signal — the source of truth.
    const result = await interactionSignal({ drugA, drugB, event });

    // Log only non-identifying signal metadata — never the drug/event strings.
    logEvent("bio.drug_interaction.success", {
      latencyMs: Date.now() - start,
      interaction: result.interaction,
      combinedReports: result.combined?.a ?? 0,
      combinedIc: result.combined?.informationComponent ?? null,
      aAloneResolved: result.aAlone !== null,
      bAloneResolved: result.bAlone !== null,
    });

    return ok(result);
  } catch (err) {
    logEvent("bio.drug_interaction.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/bio/drug-interaction] failed:", err);
    return fail(
      "Something went wrong while computing the drug-interaction signal. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
