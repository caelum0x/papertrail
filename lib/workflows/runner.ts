// Workflow runner: executes a workflow definition step-by-step, reusing the
// existing PaperTrail agents where relevant, and records a full observability
// trace (agent_runs + agent_steps) so the console can replay exactly what each
// stage did. Step context is threaded immutably — every step returns a NEW merged
// context rather than mutating the running one.

import { z } from "zod";
import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { retrieveSources } from "@/lib/agents/retrievalAgent";
import { extractFinding } from "@/lib/agents/extractionAgent";
import { verifyClaim } from "@/lib/agents/verificationAgent";
import { checkAgainstRegistry } from "@/lib/structuredVerification";
import { callClaudeForJson } from "@/lib/claude";
import type { SourceCandidate, ExtractedFinding } from "@/lib/schemas";
import type { GroundedVerificationResult } from "@/lib/grounding";
import type { Ctx } from "@/lib/api/handler";
import { getBuiltinWorkflow } from "./registry";
import type { CustomWorkflow } from "./repository";
import { getCustomWorkflow } from "./repository";
import type {
  StepExecutor,
  StepResult,
  StepTrace,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowRunInput,
} from "./types";

// A workflow context missing a required prior output (e.g. verify before retrieve).
class WorkflowStepError extends Error {}

// ── Executors ──────────────────────────────────────────────────────────────
// Each executor is keyed by WorkflowStepDef.kind. It reads what it needs from the
// threaded context (populated by earlier steps) and returns a partial context to
// merge forward plus a human-readable output for the trace viewer.

function requireSources(ctx: WorkflowContext): SourceCandidate[] {
  const sources = ctx.sources as SourceCandidate[] | undefined;
  if (!sources || sources.length === 0) {
    throw new WorkflowStepError(
      "No confident source match was found, so downstream steps cannot run."
    );
  }
  return sources;
}

const retrieveStep: StepExecutor = async (input) => {
  const sources = await retrieveSources(input.claim, {
    preferExternalId: input.preferExternalId,
  });
  return {
    context: { sources },
    output: {
      matchCount: sources.length,
      sources: sources.map((s) => ({
        id: s.id,
        title: s.title,
        externalId: s.external_id,
        similarity: Number(s.similarity.toFixed(3)),
        url: s.url,
      })),
    },
    tokens: null,
  };
};

const extractStep: StepExecutor = async (_input, ctx) => {
  const sources = requireSources(ctx);
  const primary = sources[0];
  const finding = await extractFinding(primary.id, primary.raw_text);
  // Extract findings for the other sources too, so verify can judge agreement.
  const others: ExtractedFinding[] = [];
  for (const source of sources.slice(1)) {
    others.push(await extractFinding(source.id, source.raw_text));
  }
  return {
    context: { finding, otherFindings: others },
    output: { finding, otherFindingCount: others.length },
    // Extraction is one Claude call per uncached source; rough token estimate.
    tokens: sources.length * 700,
  };
};

const verifyStep: StepExecutor = async (input, ctx) => {
  const sources = requireSources(ctx);
  const finding = ctx.finding as ExtractedFinding | undefined;
  if (!finding) {
    throw new WorkflowStepError(
      "Verify requires an extracted finding; run an extract step first."
    );
  }
  const otherFindings = (ctx.otherFindings as ExtractedFinding[] | undefined) ?? [];
  const result = await verifyClaim({
    claim: input.claim,
    finding,
    sourceRawText: sources[0].raw_text,
    otherFindings,
  });
  return {
    context: { verification: result },
    output: result,
    tokens: 1000,
  };
};

const registryCheckStep: StepExecutor = async (input, ctx) => {
  const sources = requireSources(ctx);
  // Find the first source that actually carries registered results to check.
  const withResults = sources.find(
    (s) => Array.isArray(s.registered_results) && s.registered_results.length > 0
  );
  const analyses = (withResults?.registered_results ?? []) as Parameters<
    typeof checkAgainstRegistry
  >[1];
  const check = checkAgainstRegistry(input.claim, analyses);
  return {
    context: { registryCheck: check },
    output: check,
    tokens: null, // deterministic — no LLM
  };
};

const DECOMPOSE_SCHEMA = z.object({
  sub_claims: z.array(z.string().min(1)).min(1).max(10),
});

const decomposeStep: StepExecutor = async (input) => {
  const parsed = await callClaudeForJson({
    system:
      "You split a compound scientific claim into atomic, independently-verifiable " +
      "sub-claims. Each sub-claim asserts exactly one thing (one effect, one " +
      "population, one endpoint). Do not add facts not present in the original. " +
      'Respond with ONLY: { "sub_claims": string[] }',
    user: `Claim:\n"${input.claim}"`,
    schema: DECOMPOSE_SCHEMA,
    maxTokens: 500,
  });
  return {
    context: { subClaims: parsed.sub_claims },
    output: { subClaims: parsed.sub_claims },
    tokens: 500,
  };
};

const citationQaStep: StepExecutor = async (_input, ctx) => {
  const sources = requireSources(ctx);
  const verification = ctx.verification as GroundedVerificationResult | undefined;
  if (!verification) {
    throw new WorkflowStepError(
      "Citation QA requires a verification result; run a verify step first."
    );
  }
  const sourceText = sources[0].raw_text;
  const spans = verification.flagged_spans ?? [];
  // Every span's source_span must be a verbatim substring of the cited source —
  // this is PaperTrail's core trust invariant, re-checked here for the QA report.
  const checks = spans.map((span) => ({
    claimSpan: span.claim_span,
    sourceSpan: span.source_span,
    grounded: sourceText.includes(span.source_span),
  }));
  const groundedCount = checks.filter((c) => c.grounded).length;
  const coverage = spans.length === 0 ? 1 : groundedCount / spans.length;
  return {
    context: { citationQa: { checks, coverage } },
    output: {
      spanCount: spans.length,
      groundedCount,
      coverage: Number(coverage.toFixed(3)),
      allGrounded: groundedCount === spans.length,
      checks,
    },
    tokens: null,
  };
};

const STEP_EXECUTORS: Readonly<Record<string, StepExecutor>> = {
  retrieve: retrieveStep,
  extract: extractStep,
  verify: verifyStep,
  "registry-check": registryCheckStep,
  decompose: decomposeStep,
  "citation-qa": citationQaStep,
};

// ── Persistence ──────────────────────────────────────────────────────────────

async function insertRun(
  pool: Pool,
  args: {
    orgId: string;
    workflowId: string | null;
    workflowKey: string;
    input: WorkflowRunInput;
    createdBy: string;
  }
): Promise<string> {
  const { rows } = await pool.query(
    `insert into agent_runs
       (org_id, workflow_id, workflow_key, status, input, created_by, started_at)
     values ($1, $2, $3, 'running', $4::jsonb, $5, now())
     returning id`,
    [
      args.orgId,
      args.workflowId,
      args.workflowKey,
      JSON.stringify(args.input),
      args.createdBy,
    ]
  );
  return rows[0].id as string;
}

async function insertStep(
  pool: Pool,
  orgId: string,
  runId: string,
  trace: StepTrace
): Promise<void> {
  await pool.query(
    `insert into agent_steps
       (org_id, run_id, step_index, name, status, input, output, error, tokens, duration_ms)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)`,
    [
      orgId,
      runId,
      trace.stepIndex,
      trace.name,
      trace.status,
      JSON.stringify(trace.input ?? null),
      JSON.stringify(trace.output ?? null),
      trace.error,
      trace.tokens,
      trace.durationMs,
    ]
  );
}

async function finalizeRun(
  pool: Pool,
  orgId: string,
  runId: string,
  status: "succeeded" | "failed",
  output: unknown,
  error: string | null
): Promise<void> {
  await pool.query(
    `update agent_runs
        set status = $1, output = $2::jsonb, error = $3, finished_at = now()
      where id = $4 and org_id = $5`,
    [status, JSON.stringify(output ?? null), error, runId, orgId]
  );
}

// ── Definition resolution ───────────────────────────────────────────────────

async function resolveDefinition(
  pool: Pool,
  orgId: string,
  workflowKey: string
): Promise<{ definition: WorkflowDefinition; workflowId: string | null }> {
  const builtin = getBuiltinWorkflow(workflowKey);
  if (builtin) {
    return { definition: builtin, workflowId: null };
  }
  // Otherwise treat the key as a custom workflow id (org-scoped).
  const custom: CustomWorkflow | null = await getCustomWorkflow(
    pool,
    orgId,
    workflowKey
  );
  if (!custom) {
    throw new WorkflowStepError(`Unknown workflow: ${workflowKey}`);
  }
  return { definition: custom.definition, workflowId: custom.id };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface WorkflowRunResult {
  runId: string;
  status: "succeeded" | "failed";
  workflowKey: string;
  output: WorkflowContext;
  steps: StepTrace[];
  error: string | null;
}

/**
 * Execute a workflow (built-in key or custom workflow id) against an input claim,
 * recording a run and per-step trace. Never throws for a step failure: the run is
 * marked "failed" with the error captured on the run and the failing step, so the
 * caller always gets a persisted, inspectable trace (honest failure over a crash).
 */
export async function runWorkflow(
  workflowKey: string,
  input: WorkflowRunInput,
  ctx: Ctx
): Promise<WorkflowRunResult> {
  const pool = getPool();
  const { definition, workflowId } = await resolveDefinition(
    pool,
    ctx.org.id,
    workflowKey
  );

  const runId = await insertRun(pool, {
    orgId: ctx.org.id,
    workflowId,
    workflowKey: definition.key,
    input,
    createdBy: ctx.user.id,
  });

  const traces: StepTrace[] = [];
  let context: WorkflowContext = {};
  let failed = false;
  let runError: string | null = null;

  for (let i = 0; i < definition.steps.length; i += 1) {
    const step = definition.steps[i];
    const executor = STEP_EXECUTORS[step.kind];
    const startedAt = Date.now();

    if (!executor) {
      const trace: StepTrace = {
        stepIndex: i,
        name: step.name,
        status: "failed",
        input: { kind: step.kind },
        output: null,
        error: `No executor registered for step kind "${step.kind}".`,
        tokens: null,
        durationMs: Date.now() - startedAt,
      };
      traces.push(trace);
      await insertStep(pool, ctx.org.id, runId, trace);
      failed = true;
      runError = trace.error;
      break;
    }

    try {
      const result: StepResult = await executor(input, context);
      const trace: StepTrace = {
        stepIndex: i,
        name: step.name,
        status: "succeeded",
        input: { kind: step.kind, claim: input.claim },
        output: result.output,
        error: null,
        tokens: result.tokens,
        durationMs: Date.now() - startedAt,
      };
      traces.push(trace);
      await insertStep(pool, ctx.org.id, runId, trace);
      // Immutable merge: build a new context object, never mutate the old one.
      context = { ...context, ...result.context };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Step failed unexpectedly.";
      const trace: StepTrace = {
        stepIndex: i,
        name: step.name,
        status: "failed",
        input: { kind: step.kind, claim: input.claim },
        output: null,
        error: message,
        tokens: null,
        durationMs: Date.now() - startedAt,
      };
      traces.push(trace);
      await insertStep(pool, ctx.org.id, runId, trace);
      failed = true;
      runError = message;
      break;
    }
  }

  const status: "succeeded" | "failed" = failed ? "failed" : "succeeded";
  await finalizeRun(pool, ctx.org.id, runId, status, context, runError);

  return {
    runId,
    status,
    workflowKey: definition.key,
    output: context,
    steps: traces,
    error: runError,
  };
}
