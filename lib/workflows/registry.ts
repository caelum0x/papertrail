// Registry of built-in agentic pipelines. Each is a declarative WorkflowDefinition
// whose steps map to executors in runner.ts. These ship in code (not the DB) so the
// demo always has working pipelines; custom org workflows persist the same shape in
// agent_workflows.definition and are validated against workflowDefinitionSchema.

import { z } from "zod";
import type { WorkflowDefinition, WorkflowStepDef } from "./types";

// Boundary schema for a (custom or built-in) workflow definition. Custom
// definitions coming from a request body are parsed through this before use so a
// malformed jsonb can never reach the runner.
export const workflowStepSchema: z.ZodType<WorkflowStepDef> = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(60),
  description: z.string().max(500),
});

export const workflowDefinitionSchema: z.ZodType<WorkflowDefinition> = z.object({
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  steps: z.array(workflowStepSchema).min(1).max(12),
});

// The four built-in pipelines. Ordered steps; every `kind` must have an executor
// registered in runner.ts's STEP_EXECUTORS.
const BUILTIN_LIST: WorkflowDefinition[] = [
  {
    key: "retrieve-extract-verify",
    name: "Retrieve → Extract → Verify",
    description:
      "The core PaperTrail pipeline: find the primary source for a claim, extract its structured finding, and audit the claim against it.",
    steps: [
      {
        name: "Retrieve sources",
        kind: "retrieve",
        description: "Semantic search over cached sources for confident matches.",
      },
      {
        name: "Extract finding",
        kind: "extract",
        description: "Extract the structured finding from the best-matching source.",
      },
      {
        name: "Verify claim",
        kind: "verify",
        description:
          "Compare the claim against the extracted finding and flag discrepancies.",
      },
    ],
  },
  {
    key: "statistical-audit",
    name: "Statistical Audit",
    description:
      "Deterministically check a claim's magnitude against a trial's REGISTERED results on ClinicalTrials.gov — ground truth, no LLM in the loop.",
    steps: [
      {
        name: "Retrieve sources",
        kind: "retrieve",
        description: "Find the trial whose registered results back the claim.",
      },
      {
        name: "Registry check",
        kind: "registry-check",
        description:
          "Compare the claimed effect against the sponsor-reported effect estimate.",
      },
    ],
  },
  {
    key: "claim-decomposition",
    name: "Claim Decomposition",
    description:
      "Break a compound claim into atomic, independently-verifiable sub-claims before retrieval, so each assertion is checked on its own.",
    steps: [
      {
        name: "Decompose claim",
        kind: "decompose",
        description: "Split the claim into atomic verifiable assertions.",
      },
      {
        name: "Retrieve sources",
        kind: "retrieve",
        description: "Find confident sources for the (recombined) claim.",
      },
      {
        name: "Extract finding",
        kind: "extract",
        description: "Extract the structured finding from the best source.",
      },
      {
        name: "Verify claim",
        kind: "verify",
        description: "Audit the claim against the extracted finding.",
      },
    ],
  },
  {
    key: "citation-qa",
    name: "Citation QA",
    description:
      "Quality-check the citation trail: confirm the flagged spans map to exact substrings of the cited source and report grounding coverage.",
    steps: [
      {
        name: "Retrieve sources",
        kind: "retrieve",
        description: "Find the primary source the claim should be cited against.",
      },
      {
        name: "Extract finding",
        kind: "extract",
        description: "Extract the structured finding from the source.",
      },
      {
        name: "Verify claim",
        kind: "verify",
        description: "Produce the verification result with flagged spans.",
      },
      {
        name: "Citation QA",
        kind: "citation-qa",
        description:
          "Check each flagged span is a verbatim substring of the cited source.",
      },
    ],
  },
];

// Indexed for O(1) lookup by key. Frozen to keep built-ins immutable at runtime.
const BUILTIN_BY_KEY: ReadonlyMap<string, WorkflowDefinition> = new Map(
  BUILTIN_LIST.map((w) => [w.key, w])
);

export function listBuiltinWorkflows(): WorkflowDefinition[] {
  // Return copies so callers can never mutate the shared built-in definitions.
  return BUILTIN_LIST.map((w) => ({ ...w, steps: w.steps.map((s) => ({ ...s })) }));
}

export function getBuiltinWorkflow(key: string): WorkflowDefinition | null {
  const found = BUILTIN_BY_KEY.get(key);
  if (!found) return null;
  return { ...found, steps: found.steps.map((s) => ({ ...s })) };
}

export function isBuiltinKey(key: string): boolean {
  return BUILTIN_BY_KEY.has(key);
}
