import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { withApiKey } from "@/lib/apiv1/gateway";
import { structureExperiment } from "@/lib/labNotebook/structure";

export const runtime = "nodejs";

// Public API: POST /api/v1/lab-notebook
// Authenticated by an org API key in the `Authorization: Bearer <api_key>` header
// (via withApiKey), so external programmatic clients can turn a wet-lab scientist's
// rough bench notes into a structured, grounded, reproducible experiment record.
//
// Stateless compute: this route runs the LAB NOTEBOOK COMPANION engine and returns
// the result. It does NOT persist anything — the notes are never written to the DB.
// Metered against the org's `verification` quota by the gateway.
//
// Governance: NEVER log the raw notes or any of the scientist's text — only counts.
// Returns the standard { success, data, error } envelope.

const NOTES_MIN = 10;
const NOTES_MAX = 20000;

const BodySchema = z.object({
  notes: z
    .string()
    .min(
      NOTES_MIN,
      "Please provide notes of at least 10 characters."
    )
    .max(
      NOTES_MAX,
      "Notes are too long (max 20000 characters). Trim to a single experiment's bench notes."
    ),
});

export const POST = withApiKey(
  async (req: NextRequest) => {
    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const result = await structureExperiment(parsed.data.notes);
    return ok(result);
  },
  { quotaKind: "verification", routeLabel: "v1.lab_notebook" }
);
