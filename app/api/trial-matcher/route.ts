import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx, parsePagination } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { classifyError, degradedMessage } from "@/lib/trialMatcher/errors";
import { runTrialMatch } from "@/lib/trialMatcher/match";
import { createRun, listRuns } from "@/lib/trialMatcher/repository";
import type { PatientProfile } from "@/lib/trialMatcher/schemas";

// CLINICAL TRIAL MATCHER endpoint (org-scoped). POST accepts free-text, de-identified
// patient notes, extracts a grounded patient profile, searches ClinicalTrials.gov, assesses
// each candidate trial's eligibility criteria against the profile, and persists the ranked
// run. GET lists prior runs for the org.
//
// Governance: NEVER log the raw notes or any patient text — only counts, ids, and verdicts.
// The notes are never persisted; only the de-identified profile and note_char_count are stored.

export const runtime = "nodejs";
export const maxDuration = 60;

const NOTES_MIN = 10;
const NOTES_MAX = 20000;

const BodySchema = z.object({
  notes: z.string().min(NOTES_MIN).max(NOTES_MAX),
});

// A short, non-identifying label for the run (e.g. the primary condition) — NOT patient text.
function derivePatientSummary(profile: PatientProfile): string {
  const primaryCondition = profile.conditions[0]?.name;
  if (primaryCondition) return primaryCondition.slice(0, 200);
  if (profile.search_terms[0]) return profile.search_terms[0].slice(0, 200);
  // Fallback so every run has a non-null, auditable label in the history list even
  // when profile extraction surfaced no condition/search term.
  return "Trial match run";
}

// GET /api/trial-matcher — list match runs for the org, newest first. Any member.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const { runs, total } = await listRuns(getPool(), ctx.org.id, { limit, offset });
    return ok(runs, { total, page, limit });
  } catch (err) {
    console.error("[/api/trial-matcher GET] failed:", err);
    return fail("Failed to load trial-match runs.", 500);
  }
});

// POST /api/trial-matcher — run a new match from de-identified notes and persist it. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  requireRole(ctx, "editor");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      `Invalid request — ${issue?.message ?? "paste de-identified patient notes (10–20000 characters)."}`,
      400
    );
  }

  const notes = parsed.data.notes;

  try {
    const result = await runTrialMatch(notes);

    const run = await createRun(getPool(), ctx.org.id, ctx.user.id, {
      patient_summary: derivePatientSummary(result.profile),
      profile: result.profile,
      note_char_count: notes.length,
      matches: result.matches,
    });

    // Log counts/verdicts ONLY — never the notes or any patient text.
    console.info("[/api/trial-matcher] run created", {
      orgId: ctx.org.id,
      runId: run.id,
      noteCharCount: notes.length,
      matches: result.matches.length,
      droppedUngrounded: result.droppedUngrounded,
      degraded: result.degraded,
      verdicts: result.matches.map((m) => m.verdict),
    });

    // Degraded but usable: profile extracted, reasoning partial/unavailable. Persist what we
    // have (a real run the coordinator can reload) and tell the client WHY so it can show an
    // honest banner instead of a silent gap. Still a 201 — a run WAS created.
    return created({
      run,
      matches: result.matches,
      droppedUngrounded: result.droppedUngrounded,
      degraded: result.degraded,
      degradedMessage: result.degraded ? degradedMessage(result.degraded) : null,
    });
  } catch (err) {
    // Profile extraction itself failed — there is nothing to persist. Distinguish an Anthropic
    // usage cap / rate limit (temporary, explainable) from a genuine error so the UI can render
    // an honest degraded banner and steer the user to the history panel, never a white screen.
    const reason = classifyError(err);
    console.error("[/api/trial-matcher POST] failed:", { reason });

    if (reason === "quota") {
      // 200 with an explicit degraded payload (no run): the tool stays usable — the client
      // renders the banner and the coordinator can reload prior runs from history.
      return ok({
        run: null,
        matches: [],
        droppedUngrounded: 0,
        degraded: "quota" as const,
        degradedMessage: degradedMessage("quota"),
      });
    }

    return fail(
      "Something went wrong while matching this patient to trials. This has been logged — please try again.",
      500
    );
  }
});
