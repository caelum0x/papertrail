// ORG-SCOPED PaperTrail MCP tools.
//
// These two tools call PaperTrail's authenticated v1 API routes, so they require an
// org API key (Bearer PAPERTRAIL_API_KEY) — unlike the read-only public tools in the
// other groups. Both are stateless compute on the server: nothing is persisted, and
// the caller's notes are never stored or logged by PaperTrail.
//
//   - structure_experiment  -> POST /api/v1/lab-notebook  { notes }
//   - match_patient_to_trials -> POST /api/v1/trial-matcher { notes }
//
// Each handler validates its args with zod, calls the deployed API via PaperTrailClient
// with auth:true (which attaches the Bearer key and errors clearly if none is set), and
// returns a human-readable summary followed by the full JSON payload. Handlers never
// throw raw — client/validation errors become a concise error string.

import { z } from "zod";
import type { PaperTrailClient } from "../client.js";
import { tool, formatResult, toErrorMessage, type PaperTrailTool } from "../registry.js";

// Shared notes bound — mirrors the v1 route zod (10..20000). Kept local so the MCP
// package imports no app code.
const NOTES_MIN = 10;
const NOTES_MAX = 20000;

const notesField = z
  .string()
  .min(NOTES_MIN, "Provide notes of at least 10 characters.")
  .max(NOTES_MAX, "Notes are too long (max 20000 characters).");

// ---------------------------------------------------------------------------
// structure_experiment — LAB NOTEBOOK COMPANION over the v1 API.
// ---------------------------------------------------------------------------
const structureExperimentInput = {
  notes: notesField.describe(
    "The scientist's rough, free-text bench notes (may be a voice-memo transcript: terse, abbreviated, out of order). 10 to 20000 characters."
  ),
} satisfies z.ZodRawShape;

interface LabNotebookResult {
  structured: unknown;
  droppedUngrounded: number;
}

const structureExperiment = tool({
  name: "structure_experiment",
  title: "Structure lab notebook experiment",
  description:
    "Turn a wet-lab scientist's rough bench notes into a structured, reproducible, fully grounded experiment record (objective, ordered protocol steps, reagents, samples, equipment, observations, outcomes, next steps, and normalized bio-entities). Every quoted field is anchored to a verbatim span of the original notes; anything the model can't point back to the notes is dropped and counted in `droppedUngrounded`, so the record never contains an unsourced claim. Use it when you have terse or abbreviation-heavy bench notes (or a voice-memo transcript of an experiment) and want a clean, searchable, audit-ready protocol. REQUIRES a PaperTrail org API key (set PAPERTRAIL_API_KEY). Nothing is persisted — this is stateless compute and the notes are not stored.",
  inputSchema: structureExperimentInput,
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (
    args: Record<string, unknown>,
    client: PaperTrailClient
  ): Promise<string> => {
    try {
      const { notes } = z.object(structureExperimentInput).parse(args);
      const result = await client.post<LabNotebookResult>(
        "/api/v1/lab-notebook",
        { notes },
        { auth: true }
      );
      const summary =
        result.droppedUngrounded > 0
          ? `Structured the experiment record and dropped ${result.droppedUngrounded} ungroundable item(s) that could not be traced to a verbatim span of the notes.`
          : "Structured the experiment record; every field is grounded to a verbatim span of the notes.";
      return formatResult(summary, result);
    } catch (err: unknown) {
      return toErrorMessage(err);
    }
  },
});

// ---------------------------------------------------------------------------
// match_patient_to_trials — CLINICAL TRIAL MATCHER over the v1 API.
// ---------------------------------------------------------------------------
const matchPatientInput = {
  notes: notesField.describe(
    "DE-IDENTIFIED, free-text patient notes (conditions, biomarkers, prior treatments, labs, performance status). Must NOT contain any direct identifiers (name, MRN, date of birth, address, phone). 10 to 20000 characters."
  ),
} satisfies z.ZodRawShape;

interface TrialMatchResult {
  profile: unknown;
  matches: Array<{
    nctId: string;
    title: string;
    eligibility_score: number;
    verdict: string;
  }>;
  droppedUngrounded: number;
}

const matchPatientToTrials = tool({
  name: "match_patient_to_trials",
  title: "Match patient to clinical trials",
  description:
    "Match a patient to ClinicalTrials.gov trials from DE-IDENTIFIED free-text notes: PaperTrail extracts a grounded, de-identified patient profile, searches for candidate trials, and assesses each trial's inclusion/exclusion criteria against the profile (met / not_met / unknown), returning a shortlist ranked by eligibility fit with per-criterion reasoning. Use it when a research coordinator has a de-identified patient summary and wants a ranked, explainable set of candidate trials rather than a raw keyword search. IMPORTANT: the input must be DE-IDENTIFIED — do NOT send patient names, MRNs, dates of birth, or other direct identifiers; PaperTrail never extracts or stores identifiers. REQUIRES a PaperTrail org API key (set PAPERTRAIL_API_KEY). Nothing is persisted — this is stateless compute and the notes are not stored.",
  inputSchema: matchPatientInput,
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (
    args: Record<string, unknown>,
    client: PaperTrailClient
  ): Promise<string> => {
    try {
      const { notes } = z.object(matchPatientInput).parse(args);
      const result = await client.post<TrialMatchResult>(
        "/api/v1/trial-matcher",
        { notes },
        { auth: true }
      );
      const top = result.matches[0];
      const summary = top
        ? `Assessed ${result.matches.length} candidate trial(s). Best fit: ${top.nctId} (${top.verdict}, score ${top.eligibility_score.toFixed(2)}) — ${top.title}.`
        : "No candidate trials matched the extracted patient profile.";
      return formatResult(summary, result);
    } catch (err: unknown) {
      return toErrorMessage(err);
    }
  },
});

// The org-scoped tool group. server.ts imports this array and registers each tool.
export const orgScopedTools: PaperTrailTool[] = [structureExperiment, matchPatientToTrials];
