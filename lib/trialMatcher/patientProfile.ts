// PATIENT PROFILE EXTRACTION — de-identified, grounded structured extraction from
// free-text clinical notes for the CLINICAL TRIAL MATCHER.
//
// A research coordinator pastes free-text patient notes. Claude extracts ONLY clinically
// relevant, de-identified facts (conditions, biomarkers, prior treatments, labs, age/sex,
// performance status) — NEVER a name, MRN, or date of birth. Every quoted field carries a
// `source_span` that must be a VERBATIM substring of the notes. After the Claude call we
// run locateSpan on every span and DROP any that cannot be located, counting the drops in
// `droppedUngrounded`. PaperTrail never makes an unsourced claim about a source.
//
// The Claude caller is injectable (opts.llm) so this logic is testable offline, exactly
// like lib/hypotheses/generate.ts. This file performs no DB or network I/O of its own.

import { callClaudeForJson } from "../claude";
import { locateSpan } from "../grounding";
import {
  PatientProfileSchema,
  type Biomarker,
  type GroundedFact,
  type Lab,
  type OtherFactor,
  type PatientProfile,
} from "./schemas";

// A Claude caller narrowed to profile extraction, injectable so tests run offline.
export type ProfileLlm = (params: {
  system: string;
  user: string;
}) => Promise<PatientProfile>;

const defaultLlm: ProfileLlm = (params) =>
  callClaudeForJson({
    system: params.system,
    user: params.user,
    schema: PatientProfileSchema,
    maxTokens: 2048,
  });

// The system prompt makes BOTH governance invariants explicit to the model: extract only
// de-identified clinically-relevant facts (never identifiers), and quote every field
// verbatim from the notes so it can be grounded.
const SYSTEM_PROMPT = `You are a clinical research coordinator's assistant extracting a structured, DE-IDENTIFIED patient profile from free-text clinical notes, so the patient can be matched against clinical trials.

HARD RULES — you will be audited against them:
- NEVER extract patient identifiers of any kind: no names, no medical record numbers (MRN), no dates of birth, no addresses, no phone numbers, no email addresses. If the notes contain them, ignore them entirely — they must not appear anywhere in your output.
- Extract ONLY clinically relevant facts that matter for trial eligibility: conditions/diagnoses, biomarkers (with status), prior treatments, relevant lab values, age (as a number of years only), sex, and performance status (e.g. ECOG).
- Every field that quotes the notes MUST include a "source_span" that is copied VERBATIM (exact characters) from the notes — a real substring, not a paraphrase. If you cannot quote a fact verbatim from the notes, do not include it.
- "age" is a plain integer number of years or null; do NOT put a date of birth there.
- Produce "search_terms": a short list (main condition first, then key biomarkers) to drive a clinical-trial search. These are plain search phrases, not quotes.
- Do not invent facts the notes do not state.

Return ONLY a JSON object of this exact shape:
{"age": number|null, "sex": string|null, "conditions":[{"name":"...","source_span":"..."}], "biomarkers":[{"name":"...","status":string|null,"source_span":"..."}], "prior_treatments":[{"name":"...","source_span":"..."}], "performance_status": string|null, "labs":[{"name":"...","value":"...","source_span":"..."}], "other_factors":[{"text":"...","source_span":"..."}], "search_terms":["..."]}`;

function buildUserPrompt(notes: string): string {
  return [
    "PATIENT NOTES (free text, de-identify as you extract — never copy identifiers):",
    "```",
    notes,
    "```",
    "",
    "Extract the de-identified, grounded patient profile per the rules. JSON only.",
  ].join("\n");
}

// Ground one array of quoted facts against the notes: keep only items whose source_span
// locates verbatim in the notes (replacing it with the exact located text), drop the rest.
// Returns the kept items plus the drop count. Pure — never mutates the input.
function groundFacts<T extends { source_span: string }>(
  items: readonly T[],
  notes: string
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let dropped = 0;
  for (const item of items) {
    const located = locateSpan(notes, item.source_span);
    if (!located) {
      dropped += 1;
      continue;
    }
    kept.push({ ...item, source_span: located.text });
  }
  return { kept, dropped };
}

/**
 * Extract a de-identified, grounded patient profile from free-text clinical notes.
 *
 * Hands the notes to Claude with the de-identification + grounding contract, validates the
 * output against PatientProfileSchema, then enforces grounding: every quoted field's
 * source_span is located verbatim in the notes (replaced with the exact located substring)
 * or the item is dropped. Dropped items are counted in `droppedUngrounded`, never hidden.
 * The Claude caller is injectable so this runs offline in tests.
 */
export async function extractPatientProfile(
  notes: string,
  opts?: { llm?: ProfileLlm }
): Promise<{ profile: PatientProfile; droppedUngrounded: number }> {
  const llm = opts?.llm ?? defaultLlm;
  const raw = await llm({ system: SYSTEM_PROMPT, user: buildUserPrompt(notes) });

  const conditions = groundFacts<GroundedFact>(raw.conditions, notes);
  const biomarkers = groundFacts<Biomarker>(raw.biomarkers, notes);
  const priorTreatments = groundFacts<GroundedFact>(raw.prior_treatments, notes);
  const labs = groundFacts<Lab>(raw.labs, notes);
  const otherFactors = groundFacts<OtherFactor>(raw.other_factors, notes);

  const droppedUngrounded =
    conditions.dropped +
    biomarkers.dropped +
    priorTreatments.dropped +
    labs.dropped +
    otherFactors.dropped;

  const profile: PatientProfile = {
    age: raw.age,
    sex: raw.sex,
    conditions: conditions.kept,
    biomarkers: biomarkers.kept,
    prior_treatments: priorTreatments.kept,
    performance_status: raw.performance_status,
    labs: labs.kept,
    other_factors: otherFactors.kept,
    search_terms: raw.search_terms,
  };

  return { profile, droppedUngrounded };
}
