import { z } from "zod";
import { workflowDefinitionSchema } from "./registry";

// Boundary validation for the agent-workflow APIs. Request bodies and query
// strings are parsed through these before any use — never trust raw input.

// Body for POST /api/agent-workflows — save a custom pipeline for the org.
export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  definition: workflowDefinitionSchema,
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

// Body for POST /api/agent-runs — start a run against a built-in or custom workflow.
// `workflowKey` is a built-in key (e.g. "retrieve-extract-verify") OR a custom
// workflow uuid; the runner resolves which.
export const startRunSchema = z.object({
  workflowKey: z.string().min(1).max(120),
  claim: z.string().min(3).max(4000),
  preferExternalId: z.string().max(120).nullish(),
});
export type StartRunInput = z.infer<typeof startRunSchema>;

// Query filters for GET /api/agent-runs.
export const runsQuerySchema = z.object({
  status: z.enum(["running", "succeeded", "failed"]).optional(),
  workflowKey: z.string().max(120).optional(),
});
export type RunsQueryInput = z.infer<typeof runsQuerySchema>;
