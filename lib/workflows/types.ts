// Shared types for the agentic workflow engine. A workflow is an ordered list of
// named steps; the runner executes them left-to-right, threading a mutable-free
// context object (each step returns a new merged context) and recording a trace
// row per step. Definitions are serializable so custom workflows can round-trip
// through the agent_workflows.definition jsonb column.

export const WORKFLOW_RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

// A single declarative step in a workflow definition. `kind` selects the executor
// registered in the runner's STEP_EXECUTORS map.
export interface WorkflowStepDef {
  name: string;
  kind: string;
  description: string;
}

// A serializable pipeline definition. Built-in pipelines ship these in code;
// custom pipelines persist the same shape in agent_workflows.definition.
export interface WorkflowDefinition {
  key: string;
  name: string;
  description: string;
  steps: WorkflowStepDef[];
}

// The value threaded between steps. Executors read prior outputs and return a
// partial context that the runner shallow-merges into a NEW object (no mutation).
export type WorkflowContext = Record<string, unknown>;

// The observability record the runner builds for each executed step.
export interface StepTrace {
  stepIndex: number;
  name: string;
  status: WorkflowStepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  tokens: number | null;
  durationMs: number;
}

// The result of executing one step, returned by an executor.
export interface StepResult {
  // Partial context to merge into the running context for later steps.
  context: WorkflowContext;
  // Human-readable output surfaced in the trace viewer.
  output: unknown;
  // Approximate tokens spent (LLM steps), or null for deterministic steps.
  tokens: number | null;
}

// Executor signature. Deliberately narrow: pure-ish functions of (input, ctx).
export type StepExecutor = (
  input: WorkflowRunInput,
  ctx: WorkflowContext
) => Promise<StepResult>;

// Validated input for a run. `claim` is required by every built-in pipeline;
// preferExternalId optionally pins retrieval to a specific cached source.
export interface WorkflowRunInput {
  claim: string;
  preferExternalId?: string;
}
