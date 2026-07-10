import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { withApiKey } from "@/lib/apiv1/gateway";
import { runTrialMatch } from "@/lib/trialMatcher/match";

export const runtime = "nodejs";
export const maxDuration = 60;

// Public API: POST /api/v1/trial-matcher
// Authenticated by an org API key in the `Authorization: Bearer <api_key>` header
// (via withApiKey), so external programmatic clients can match a de-identified
// patient against ClinicalTrials.gov trials: extract a grounded patient profile,
// search for candidate trials, and assess each trial's eligibility criteria.
//
// Stateless compute: this route runs the CLINICAL TRIAL MATCHER engine and returns
// the result. It does NOT persist anything — the notes are never written to the DB.
// Metered against the org's `verification` quota by the gateway.
//
// Governance: the caller MUST send DE-IDENTIFIED notes. NEVER log the raw notes or
// any patient text — only counts. Returns the standard { success, data, error } envelope.

const NOTES_MIN = 10;
const NOTES_MAX = 20000;

const BodySchema = z.object({
  notes: z
    .string()
    .min(
      NOTES_MIN,
      "Please provide de-identified patient notes of at least 10 characters."
    )
    .max(
      NOTES_MAX,
      "Notes are too long (max 20000 characters). Paste one patient's de-identified notes."
    ),
});

export const POST = withApiKey(
  async (req: NextRequest) => {
    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const { profile, matches, droppedUngrounded } = await runTrialMatch(
      parsed.data.notes
    );
    return ok({ profile, matches, droppedUngrounded });
  },
  { quotaKind: "verification", routeLabel: "v1.trial_matcher" }
);
