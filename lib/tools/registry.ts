import { z } from "zod";
import type { Ctx } from "@/lib/api/handler";
import { retrieveSources } from "@/lib/agents/retrievalAgent";
import { extractFinding } from "@/lib/agents/extractionAgent";
import { verifyClaim } from "@/lib/agents/verificationAgent";
import { checkAgainstRegistry } from "@/lib/structuredVerification";
import { riskRatioFromCounts } from "@/lib/biostats";
import { parseSourceId } from "@/lib/sourceId";
import type { TrialResultAnalysis } from "@/lib/sources/clinicaltrials";
import type { BuiltinTool, ToolDescriptor, ToolResult } from "./types";
import { zodToJsonSchema } from "./jsonSchema";

// The tool registry exposes PaperTrail's verification pipeline as a set of named,
// schema-validated tools (an MCP-style toolset). Each built-in tool reuses the same
// agents/verification the main /api/verify route uses — no logic is duplicated here,
// only re-composed behind a stable tool contract. listTools() enumerates them and
// callTool() validates + executes one, returning a structured ToolResult the API
// layer records to tool_calls.

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const verifyClaimInput = z
  .object({
    claim: z
      .string()
      .min(10, "Provide a claim of at least 10 characters.")
      .max(2000, "Claim is too long (max 2000 characters).")
      .describe("The public-facing efficacy claim to verify against its primary source."),
    source_hint: z
      .string()
      .max(200)
      .optional()
      .describe("Optional DOI / PMID / NCT id the claim cited, to pin retrieval to that source."),
  })
  .describe("Verify a clinical-trial efficacy claim against its retrieved primary source.");

const checkRegistryInput = z
  .object({
    claim: z
      .string()
      .min(10, "Provide a claim of at least 10 characters.")
      .max(2000)
      .describe("The claim whose magnitude/significance is checked against registered results."),
    nct_id: z
      .string()
      .min(3)
      .max(40)
      .optional()
      .describe("An NCT id to check against. If omitted, the best retrieved trial source is used."),
  })
  .describe("Deterministically check a claim against a trial's REGISTERED ClinicalTrials.gov results.");

const extractFindingsInput = z
  .object({
    claim: z
      .string()
      .min(10)
      .max(2000)
      .describe("A claim used to retrieve the most relevant primary source to extract from."),
    source_hint: z
      .string()
      .max(200)
      .optional()
      .describe("Optional DOI / PMID / NCT id to pin the source that gets extracted."),
  })
  .describe("Retrieve the best-matching source for a claim and extract its structured finding.");

const recomputeStatsInput = z
  .object({
    events_treatment: z.number().int().min(0).describe("Event count in the treatment arm."),
    total_treatment: z.number().int().min(1).describe("Total participants in the treatment arm."),
    events_control: z.number().int().min(0).describe("Event count in the comparator/control arm."),
    total_control: z.number().int().min(1).describe("Total participants in the comparator/control arm."),
  })
  .describe("Recompute a risk ratio, 95% CI, and reduction from a 2x2 event/total table.");

// ---------------------------------------------------------------------------
// Executors — each reuses an existing agent / verification function.
// ---------------------------------------------------------------------------

async function runVerifyClaim(
  input: z.infer<typeof verifyClaimInput>
): Promise<unknown> {
  const parsedHint = input.source_hint ? parseSourceId(input.source_hint) : null;
  const sources = await retrieveSources(
    input.claim,
    parsedHint ? { preferExternalId: parsedHint.id } : undefined
  );

  if (sources.length === 0) {
    return {
      status: "no_support_found",
      message:
        "No confident matching primary source was found in PubMed or ClinicalTrials.gov for this claim.",
    };
  }

  const source = sources[0];
  const corroborating = sources.slice(1);
  const findings = await Promise.all(sources.map((s) => extractFinding(s.id, s.raw_text)));
  const finding = findings[0];

  const verification = await verifyClaim({
    claim: input.claim,
    finding,
    sourceRawText: source.raw_text,
    otherFindings: findings.slice(1),
  });

  return {
    status: "verified",
    claim: input.claim,
    source: {
      title: source.title,
      url: source.url,
      source_type: source.source_type,
      external_id: source.external_id,
    },
    corroborating_sources: corroborating.map((s) => ({
      title: s.title,
      url: s.url,
      external_id: s.external_id,
    })),
    finding,
    verification,
  };
}

async function runCheckRegistry(
  input: z.infer<typeof checkRegistryInput>
): Promise<unknown> {
  // Pin to the given NCT id if provided, otherwise use the best retrieved source.
  const preferId = input.nct_id ? parseSourceId(input.nct_id)?.id ?? input.nct_id : undefined;
  const sources = await retrieveSources(
    input.claim,
    preferId ? { preferExternalId: preferId } : undefined
  );
  const trial = sources.find((s) => s.source_type === "clinicaltrials") ?? null;

  if (!trial) {
    return {
      verdict: "no_registered_results",
      rationale:
        "No ClinicalTrials.gov source with registered results was retrieved for this claim.",
      source: null,
    };
  }

  const analyses = (trial.registered_results ?? []) as TrialResultAnalysis[];
  const check = checkAgainstRegistry(input.claim, analyses);
  return {
    ...check,
    source: {
      title: trial.title,
      url: trial.url,
      external_id: trial.external_id,
    },
  };
}

async function runExtractFindings(
  input: z.infer<typeof extractFindingsInput>
): Promise<unknown> {
  const parsedHint = input.source_hint ? parseSourceId(input.source_hint) : null;
  const sources = await retrieveSources(
    input.claim,
    parsedHint ? { preferExternalId: parsedHint.id } : undefined
  );

  if (sources.length === 0) {
    return {
      status: "no_source_found",
      message: "No confident matching primary source was found to extract a finding from.",
    };
  }

  const source = sources[0];
  const finding = await extractFinding(source.id, source.raw_text);
  return {
    status: "extracted",
    source: {
      title: source.title,
      url: source.url,
      source_type: source.source_type,
      external_id: source.external_id,
    },
    finding,
  };
}

async function runRecomputeStats(
  input: z.infer<typeof recomputeStatsInput>
): Promise<unknown> {
  const estimate = riskRatioFromCounts(
    input.events_treatment,
    input.total_treatment,
    input.events_control,
    input.total_control
  );
  if (!estimate) {
    return {
      status: "not_computable",
      message:
        "Those counts couldn't be turned into a valid risk ratio (check that events <= totals and totals > 0).",
    };
  }
  return { status: "computed", estimate };
}

// ---------------------------------------------------------------------------
// Built-in tool table
// ---------------------------------------------------------------------------

const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    name: "verify_claim",
    description:
      "Verify a clinical-trial efficacy claim against its retrieved primary source, returning a trust score, discrepancy type, and grounded flagged spans.",
    inputSchema: verifyClaimInput,
    execute: (input) => runVerifyClaim(input as z.infer<typeof verifyClaimInput>),
  },
  {
    name: "check_registry",
    description:
      "Deterministically compare a claim's stated effect against a trial's REGISTERED ClinicalTrials.gov result (paramValue / CI / p-value). No LLM in the numeric loop.",
    inputSchema: checkRegistryInput,
    execute: (input) => runCheckRegistry(input as z.infer<typeof checkRegistryInput>),
  },
  {
    name: "extract_findings",
    description:
      "Retrieve the best-matching primary source for a claim and extract its structured finding (effect size, population, condition, endpoint, caveats).",
    inputSchema: extractFindingsInput,
    execute: (input) => runExtractFindings(input as z.infer<typeof extractFindingsInput>),
  },
  {
    name: "recompute_stats",
    description:
      "Recompute a risk ratio, 95% confidence interval, relative reduction, and significance from a raw 2x2 event/total table using the log-RR delta method.",
    inputSchema: recomputeStatsInput,
    execute: (input) => runRecomputeStats(input as z.infer<typeof recomputeStatsInput>),
  },
];

const BUILTIN_BY_NAME = new Map<string, BuiltinTool>(
  BUILTIN_TOOLS.map((t) => [t.name, t])
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The set of built-in tool names, for callers that need to distinguish them. */
export function isBuiltinTool(name: string): boolean {
  return BUILTIN_BY_NAME.has(name);
}

/** Descriptors for every built-in tool (name, description, JSON-schema input). */
export function listTools(): ToolDescriptor[] {
  return BUILTIN_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    source: "builtin",
    enabled: true,
    inputSchema: zodToJsonSchema(t.inputSchema),
  }));
}

/**
 * Validate `input` against the named built-in tool's schema and execute it.
 * Never throws for expected failures (unknown tool / invalid input / executor
 * error) — returns a structured ToolResult the API layer records to tool_calls.
 */
export async function callTool(
  name: string,
  input: unknown,
  ctx: Ctx
): Promise<ToolResult> {
  const start = Date.now();
  const tool = BUILTIN_BY_NAME.get(name);
  if (!tool) {
    return {
      ok: false,
      output: null,
      error: `Unknown tool: ${name}.`,
      durationMs: Date.now() - start,
    };
  }

  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      output: null,
      error: parsed.error.issues[0]?.message ?? "Invalid tool input.",
      durationMs: Date.now() - start,
    };
  }

  try {
    const output = await tool.execute(parsed.data, ctx);
    return { ok: true, output, error: null, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      output: null,
      error: err instanceof Error ? err.message : "Tool execution failed.",
      durationMs: Date.now() - start,
    };
  }
}
