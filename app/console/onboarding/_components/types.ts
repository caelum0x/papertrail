// Shared client types for the onboarding console module. These mirror the shapes
// returned by /api/onboarding/* (see app/api/onboarding/repository.ts). Kept
// standalone so the console module stays decoupled from server-only imports.

export const STEP_IDS = [
  "welcome",
  "workspace",
  "invite",
  "sample_data",
  "finish",
] as const;

export type StepId = (typeof STEP_IDS)[number];

export type StepMap = Partial<Record<StepId, string>>;

export interface OnboardingState {
  id: string;
  org_id: string;
  user_id: string;
  steps: StepMap;
  completed: boolean;
  created_at: string;
}

export interface ChecklistItem {
  id: StepId;
  title: string;
  blurb: string;
  optional: boolean;
  done: boolean;
  completed_at: string | null;
}

export interface Checklist {
  items: ChecklistItem[];
  completed: boolean;
  required_total: number;
  required_done: number;
  percent: number;
}

export interface SeededSample {
  project: { id: string; name: string };
  claim: { id: string; text: string };
  already_existed: boolean;
}
