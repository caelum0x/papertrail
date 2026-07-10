// Client-side view types for the CLINICAL TRIAL MATCHER console. These mirror the shapes
// the API returns (the org-scoped routes project the persisted rows + the fresh run result).

import type {
  CriterionAssessment,
  PatientProfile,
  TrialMatch,
  TrialMatchRow,
  TrialMatchRunRow,
} from "@/lib/trialMatcher/schemas";

export type {
  CriterionAssessment,
  PatientProfile,
  TrialMatch,
  TrialMatchRow,
  TrialMatchRunRow,
};

// POST /api/trial-matcher response: the persisted run header + the fresh ranked matches
// (with full criteria) + how many ungroundable profile spans were dropped.
export interface RunResponse {
  run: TrialMatchRunRow;
  matches: TrialMatch[];
  droppedUngrounded: number;
}

// GET /api/trial-matcher/[id] response: a run header + its persisted matches.
export interface RunDetailResponse {
  run: TrialMatchRunRow;
  matches: TrialMatchRow[];
}
