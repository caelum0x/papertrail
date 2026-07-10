// ELIGIBILITY PARSING + PER-CRITERION ASSESSMENT + DETERMINISTIC SCORING.
//
// The registry stores eligibility as one free-text blob. We split it deterministically
// into inclusion/exclusion criteria (parseEligibility), then make ONE Claude call per
// trial that returns a met/not_met/unknown assessment for each criterion, with reasoning
// grounded to the exact criterion text. Grounding is enforced in CODE (locateSpan) — the
// model is asked to quote, but we verify: a source_span that can't be located verbatim in
// the raw criteria is nulled. Finally the eligibility SCORE and VERDICT are computed
// DETERMINISTICALLY from the assessments — no LLM in the number.
//
// SEMANTICS (critical): for an EXCLUSION criterion, assessment="met" means the patient
// MEETS the exclusion, which DISQUALIFIES them. For an INCLUSION criterion, "met" is
// favourable. See scoreCriteria for the exact scoring rules.
//
// The Claude caller is injectable (opts.llm) so this runs offline in tests. No DB/network
// I/O here beyond the injectable LLM.

import { callClaudeForJson } from "../claude";
import { locateSpan } from "../grounding";
import type { TrialCandidate } from "../sources/clinicaltrials";
import {
  TrialAssessmentLlmOutputSchema,
  type CriterionAssessment,
  type PatientProfile,
  type TrialAssessmentLlmOutput,
  type TrialMatch,
  type TrialVerdict,
} from "./schemas";

// ---------------------------------------------------------------------------
// DETERMINISTIC ELIGIBILITY PARSING. Registries write the blob in a few common layouts:
// an "Inclusion Criteria:" heading followed by bullets, then "Exclusion Criteria:", or
// plain newline-separated lists. We split on the headings, then on bullets/newlines, and
// trim bullet markers. Anything before the first recognised heading is treated as
// inclusion (the common "criteria then exclusions" layout). Pure, no LLM.
// ---------------------------------------------------------------------------

const INCLUSION_HEADING = /inclusion\s+criteria\s*:?/i;
const EXCLUSION_HEADING = /exclusion\s+criteria\s*:?/i;

// Strip a leading bullet/number marker and surrounding whitespace from a criterion line.
function cleanCriterion(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·‣▪◦]|\d+[.)]|[a-z][.)]|\([a-z0-9]+\))\s*/i, "")
    .trim();
}

// Split a block of text into individual criterion strings on newlines and bullet markers.
function splitCriteria(block: string): string[] {
  return block
    .split(/\r?\n|(?=\s[-*•·‣▪◦]\s)/)
    .map(cleanCriterion)
    .filter((c) => c.length > 0);
}

export function parseEligibility(raw: string): { inclusion: string[]; exclusion: string[] } {
  if (!raw || raw.trim().length === 0) {
    return { inclusion: [], exclusion: [] };
  }

  const exclMatch = raw.match(EXCLUSION_HEADING);
  const inclMatch = raw.match(INCLUSION_HEADING);

  // No exclusion heading: everything is inclusion (drop a leading inclusion heading).
  if (!exclMatch || exclMatch.index === undefined) {
    const body = inclMatch ? raw.slice((inclMatch.index ?? 0) + inclMatch[0].length) : raw;
    return { inclusion: splitCriteria(body), exclusion: [] };
  }

  const exclStart = exclMatch.index;
  // Inclusion block: from just after the inclusion heading (or start) up to the exclusion
  // heading. Anything before the first heading is treated as inclusion context.
  const inclHeadingEnd =
    inclMatch && inclMatch.index !== undefined && inclMatch.index < exclStart
      ? inclMatch.index + inclMatch[0].length
      : 0;
  const inclusionBlock = raw.slice(inclHeadingEnd, exclStart);
  const exclusionBlock = raw.slice(exclStart + exclMatch[0].length);

  return {
    inclusion: splitCriteria(inclusionBlock),
    exclusion: splitCriteria(exclusionBlock),
  };
}

// ---------------------------------------------------------------------------
// CLAUDE ASSESSMENT. One call per trial: for each parsed criterion, the model returns a
// met/not_met/unknown assessment with reasoning, echoing the exact criterion text as
// source_span so we can ground it against the raw criteria blob.
// ---------------------------------------------------------------------------

export type AssessLlm = (params: {
  system: string;
  user: string;
}) => Promise<TrialAssessmentLlmOutput>;

const defaultLlm: AssessLlm = (params) =>
  callClaudeForJson({
    system: params.system,
    user: params.user,
    schema: TrialAssessmentLlmOutputSchema,
    maxTokens: 3072,
  });

const SYSTEM_PROMPT = `You are a clinical research coordinator assessing whether a de-identified patient is eligible for a clinical trial. You are given the patient's structured profile and the trial's parsed inclusion and exclusion criteria. For EACH criterion, decide whether it is met, not_met, or unknown for THIS patient.

SEMANTICS — read carefully:
- For an INCLUSION criterion, "met" means the patient satisfies it (good for eligibility); "not_met" means they do not (bad); "unknown" means the profile does not say.
- For an EXCLUSION criterion, "met" means the patient MEETS the exclusion condition — i.e. they WOULD BE EXCLUDED (bad for eligibility); "not_met" means they do not meet it (good); "unknown" means the profile does not say.

HARD RULES:
- Assess EVERY criterion you are given — return one object per criterion, preserving its type.
- Set "text" to the criterion text you were given, and "source_span" to the VERBATIM criterion text (an exact substring of the trial's eligibility text) so it can be grounded. If you cannot quote it exactly, set source_span to null.
- Base each assessment ONLY on the supplied patient profile. When the profile is silent on what a criterion asks, the assessment is "unknown" — do NOT guess.
- "reasoning" is one or two sentences tying the criterion to the specific profile facts (or noting the profile is silent).

Return ONLY a JSON object of this exact shape:
{"criteria":[{"type":"inclusion"|"exclusion","text":"...","source_span":"..."|null,"assessment":"met"|"not_met"|"unknown","reasoning":"..."}]}`;

function profileToLines(profile: PatientProfile): string {
  const lines: string[] = [];
  if (profile.age !== null) lines.push(`Age: ${profile.age}`);
  if (profile.sex) lines.push(`Sex: ${profile.sex}`);
  if (profile.performance_status) lines.push(`Performance status: ${profile.performance_status}`);
  if (profile.conditions.length)
    lines.push(`Conditions: ${profile.conditions.map((c) => c.name).join("; ")}`);
  if (profile.biomarkers.length)
    lines.push(
      `Biomarkers: ${profile.biomarkers
        .map((b) => (b.status ? `${b.name} (${b.status})` : b.name))
        .join("; ")}`
    );
  if (profile.prior_treatments.length)
    lines.push(`Prior treatments: ${profile.prior_treatments.map((t) => t.name).join("; ")}`);
  if (profile.labs.length)
    lines.push(`Labs: ${profile.labs.map((l) => `${l.name}=${l.value}`).join("; ")}`);
  if (profile.other_factors.length)
    lines.push(`Other factors: ${profile.other_factors.map((o) => o.text).join("; ")}`);
  return lines.length ? lines.join("\n") : "(no structured facts extracted)";
}

function buildUserPrompt(
  profile: PatientProfile,
  parsed: { inclusion: string[]; exclusion: string[] }
): string {
  const incl = parsed.inclusion.map((c, i) => `  I${i + 1}. ${c}`).join("\n") || "  (none listed)";
  const excl = parsed.exclusion.map((c, i) => `  E${i + 1}. ${c}`).join("\n") || "  (none listed)";
  return [
    "PATIENT PROFILE (de-identified):",
    profileToLines(profile),
    "",
    "INCLUSION CRITERIA:",
    incl,
    "",
    "EXCLUSION CRITERIA:",
    excl,
    "",
    "Assess every criterion (met / not_met / unknown) per the rules. JSON only.",
  ].join("\n");
}

// Ground each assessment's source_span against the raw eligibility text: replace with the
// exact located substring, or null it if ungroundable. Returns a NEW array (no mutation).
// We keep the criterion either way — an ungroundable QUOTE is nulled, but the assessment
// itself (built from the profile, not a source claim) still stands.
function groundAssessments(
  assessments: readonly CriterionAssessment[],
  rawCriteria: string
): CriterionAssessment[] {
  return assessments.map((a) => {
    if (a.source_span === null) return { ...a };
    const located = locateSpan(rawCriteria, a.source_span);
    return { ...a, source_span: located ? located.text : null };
  });
}

// ---------------------------------------------------------------------------
// DETERMINISTIC SCORING — NO LLM in the number. Scoring rules:
//
//  * DISQUALIFIER: any EXCLUSION criterion assessed "met" (patient meets the exclusion) or
//    any INCLUSION criterion assessed "not_met" (patient fails a required inclusion). Either
//    means the patient does not qualify => verdict likely_ineligible, score forced low.
//  * Otherwise the score is the fraction of RESOLVED criteria that are favourable:
//      favourable = inclusion "met"  OR  exclusion "not_met"
//      resolved   = favourable + unfavourable (i.e. everything that is not "unknown")
//    unknown criteria are neutral-but-flagged: they don't count toward the denominator, but
//    a run of them caps confidence (reflected in the verdict below).
//  * eligibility_score in 0..1. With a disqualifier present, score = 0.
//
// VERDICT rules (documented so a reviewer can audit them):
//  * likely_ineligible : a disqualifier is present.
//  * unknown           : no criteria at all, OR every criterion is "unknown" (nothing to go on).
//  * likely_eligible   : no disqualifier, every resolved criterion is favourable, and at
//                        least half of all criteria are resolved (not mostly unknown).
//  * possibly_eligible : anything else (no disqualifier, but meaningful unknowns remain).
// ---------------------------------------------------------------------------

interface ScoreResult {
  score: number;
  verdict: TrialVerdict;
}

function isFavourable(a: CriterionAssessment): boolean {
  return (
    (a.type === "inclusion" && a.assessment === "met") ||
    (a.type === "exclusion" && a.assessment === "not_met")
  );
}

function isDisqualifying(a: CriterionAssessment): boolean {
  return (
    (a.type === "exclusion" && a.assessment === "met") ||
    (a.type === "inclusion" && a.assessment === "not_met")
  );
}

export function scoreCriteria(assessments: readonly CriterionAssessment[]): ScoreResult {
  if (assessments.length === 0) {
    return { score: 0, verdict: "unknown" };
  }

  const disqualified = assessments.some(isDisqualifying);
  if (disqualified) {
    return { score: 0, verdict: "likely_ineligible" };
  }

  const favourable = assessments.filter(isFavourable).length;
  const resolved = assessments.filter((a) => a.assessment !== "unknown").length;

  // Every criterion is unknown — nothing to base a verdict on.
  if (resolved === 0) {
    return { score: 0, verdict: "unknown" };
  }

  const score = favourable / resolved; // 0..1; with no disqualifier this is really >0.
  const resolvedFraction = resolved / assessments.length;

  const verdict: TrialVerdict =
    favourable === resolved && resolvedFraction >= 0.5
      ? "likely_eligible"
      : "possibly_eligible";

  return { score, verdict };
}

/**
 * Assess a single trial candidate against a patient profile and score it deterministically.
 *
 * Parses the raw eligibility text into inclusion/exclusion criteria, makes ONE Claude call
 * returning a met/not_met/unknown assessment per criterion, grounds each source_span against
 * the raw criteria (nulling ungroundable quotes), then computes the eligibility score and
 * verdict DETERMINISTICALLY from the assessments — no LLM in the number. When a trial lists
 * no parseable criteria, returns an honest "unknown" verdict rather than a fabricated score.
 * The Claude caller is injectable so this runs offline in tests.
 */
export async function assessTrial(
  profile: PatientProfile,
  candidate: TrialCandidate,
  opts?: { llm?: AssessLlm }
): Promise<TrialMatch> {
  const parsed = parseEligibility(candidate.eligibilityCriteria);

  // No criteria to assess — don't invent a match. Honest "unknown".
  if (parsed.inclusion.length === 0 && parsed.exclusion.length === 0) {
    return {
      nctId: candidate.nctId,
      title: candidate.title,
      url: candidate.url,
      phase: candidate.phase,
      overallStatus: candidate.overallStatus,
      eligibility_score: 0,
      verdict: "unknown",
      criteria: [],
    };
  }

  const llm = opts?.llm ?? defaultLlm;
  const raw = await llm({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(profile, parsed),
  });

  const grounded = groundAssessments(raw.criteria, candidate.eligibilityCriteria);
  const { score, verdict } = scoreCriteria(grounded);

  return {
    nctId: candidate.nctId,
    title: candidate.title,
    url: candidate.url,
    phase: candidate.phase,
    overallStatus: candidate.overallStatus,
    eligibility_score: score,
    verdict,
    criteria: grounded,
  };
}
