// Shared types for the feature-flags & experiments module. Framework-agnostic
// so both the API route handlers and the client components can import them.
// DB rows are snake_case; these camelCase shapes are what the API returns.

// A targeting rule: if a subject's attribute satisfies the operator, the flag
// is forced on (or off) regardless of the percentage rollout. Rules are opaque
// to the DB — their shape is enforced by zod at the API boundary.
export const RULE_OPERATORS = [
  "equals",
  "not_equals",
  "in",
  "contains",
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export interface FlagRule {
  attribute: string; // e.g. "plan", "email", "country"
  operator: RuleOperator;
  value: string | string[];
  effect: "on" | "off"; // whether a match forces the flag on or off
}

export interface FeatureFlag {
  id: string;
  orgId: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPercent: number;
  rules: FlagRule[];
  createdAt: string;
}

export interface FlagEvaluation {
  key: string;
  subjectId: string;
  enabled: boolean;
  reason:
    | "flag_disabled"
    | "rule_match_on"
    | "rule_match_off"
    | "rollout_in"
    | "rollout_out"
    | "flag_not_found";
}

export const EXPERIMENT_STATUSES = [
  "draft",
  "running",
  "paused",
  "completed",
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

// A single arm of an experiment. Weights are relative; they need not sum to 100.
export interface ExperimentVariant {
  key: string;
  name: string;
  weight: number;
}

export interface Experiment {
  id: string;
  orgId: string;
  key: string;
  name: string;
  status: ExperimentStatus;
  variants: ExperimentVariant[];
  createdAt: string;
}

export interface ExperimentAssignment {
  id: string;
  orgId: string;
  experimentId: string;
  subjectId: string;
  variant: string;
  createdAt: string;
}
