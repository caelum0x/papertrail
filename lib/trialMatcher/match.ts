// CLINICAL TRIAL MATCHER — top-level orchestration.
//
// Flow: extract a de-identified, grounded patient profile from the notes -> build a trial
// search query from the profile's search_terms -> search ClinicalTrials.gov for candidate
// trials (capped) -> assess ALL candidates in parallel (one Claude call each, per-criterion
// met/not_met/unknown with deterministic scoring) -> sort by eligibility fit, best first.
//
// Both the retrieval (search) and the Claude calls (profile extraction + per-trial
// assessment) are injectable so the whole pipeline runs offline in tests. This file does no
// direct DB I/O; persistence lives in repository.ts.

import {
  searchTrialsForMatching,
  type TrialCandidate,
} from "../sources/clinicaltrials";
import { assessTrial, type AssessLlm } from "./eligibility";
import { extractPatientProfile, type ProfileLlm } from "./patientProfile";
import type { PatientProfile, TrialMatch, TrialMatchRunResult } from "./schemas";

// Cap on candidate trials assessed per run — bounds token spend and latency while keeping
// a useful ranked shortlist. (Search may return more; we assess at most this many.)
const MAX_CANDIDATES = 5;

// Injectable search function, defaulting to the live ClinicalTrials.gov client.
export type TrialSearch = (query: string) => Promise<TrialCandidate[]>;

const defaultSearch: TrialSearch = (query) => searchTrialsForMatching(query, MAX_CANDIDATES + 1);

// Build a trial-search query from the profile: prefer the extracted search_terms; fall back
// to condition names if the model produced none, so a sparse profile still searches.
function buildQuery(profile: PatientProfile): string {
  const terms = profile.search_terms.length
    ? profile.search_terms
    : profile.conditions.map((c) => c.name);
  return terms.join(" ").trim();
}

/**
 * Run the full clinical-trial match for a set of de-identified patient notes.
 *
 * Extracts the grounded patient profile, searches ClinicalTrials.gov for candidate trials,
 * assesses each candidate's eligibility criteria against the profile IN PARALLEL, and returns
 * the matches sorted by eligibility_score (best fit first). `search` and `llm` are injectable
 * so tests run without the network or the Anthropic API. Returns the profile, ranked matches,
 * and the count of ungroundable profile spans that were dropped.
 */
export async function runTrialMatch(
  notes: string,
  opts?: { llm?: ProfileLlm; assessLlm?: AssessLlm; search?: TrialSearch }
): Promise<TrialMatchRunResult> {
  const { profile, droppedUngrounded } = await extractPatientProfile(
    notes,
    opts?.llm ? { llm: opts.llm } : undefined
  );

  const query = buildQuery(profile);

  // No usable query means we can't search — return the profile with no matches rather than
  // firing a meaningless search. An honest empty result beats a spurious one.
  if (query.length === 0) {
    return { profile, matches: [], droppedUngrounded };
  }

  const search = opts?.search ?? defaultSearch;
  const found = await search(query);
  const candidates = found.slice(0, MAX_CANDIDATES);

  const assessLlm = opts?.assessLlm;
  const matches: TrialMatch[] = await Promise.all(
    candidates.map((candidate) =>
      assessTrial(profile, candidate, assessLlm ? { llm: assessLlm } : undefined)
    )
  );

  // Sort by eligibility fit, best first. Stable enough for a shortlist; ties keep search order.
  const ranked = [...matches].sort((a, b) => b.eligibility_score - a.eligibility_score);

  return { profile, matches: ranked, droppedUngrounded };
}
