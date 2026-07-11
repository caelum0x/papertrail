// Client-side view types for the CLINICAL TRIAL MATCHER console. These mirror the shapes
// the API returns (the org-scoped routes project the persisted rows + the fresh run result).

import type {
  CriterionAssessment,
  DegradedReason,
  PatientProfile,
  TrialMatch,
  TrialMatchRow,
  TrialMatchRunRow,
} from "@/lib/trialMatcher/schemas";

export type {
  CriterionAssessment,
  DegradedReason,
  PatientProfile,
  TrialMatch,
  TrialMatchRow,
  TrialMatchRunRow,
};

// POST /api/trial-matcher response: the persisted run header + the fresh ranked matches
// (with full criteria) + how many ungroundable profile spans were dropped.
//
// DEGRADED runs: when Claude is usage-capped, `run` may be null (profile extraction never
// completed) and `degraded`/`degradedMessage` explain why. The client renders an honest
// banner and still lets the coordinator reload prior runs from history.
export interface RunResponse {
  run: TrialMatchRunRow | null;
  matches: TrialMatch[];
  droppedUngrounded: number;
  degraded: DegradedReason | null;
  degradedMessage: string | null;
}

// GET /api/trial-matcher/[id] response: a run header + its persisted matches.
export interface RunDetailResponse {
  run: TrialMatchRunRow;
  matches: TrialMatchRow[];
}
