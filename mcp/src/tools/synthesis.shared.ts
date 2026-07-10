// Shared zod shapes and handler helpers for the evidence-synthesis tool group.
//
// Kept separate from synthesis.ts so each file stays focused and under the size
// budget. server.ts only imports the `synthesisTools` array from synthesis.ts;
// this module is an implementation detail of that group.

import { z } from "zod";
import { formatResult, toErrorMessage, type PaperTrailTool } from "../registry.js";
import type { PaperTrailClient } from "../client.js";

// One ratio-scale study effect: EITHER a point estimate + confidence interval on
// the ratio scale (RR/HR/OR), OR the four raw 2x2 cell counts. Used by the
// meta-analysis, subgroup, and evidence-report engines, which standardize both
// forms to a log-effect internally.
export const ratioStudyFields = {
  label: z.string().min(1).max(200).describe("Study label, e.g. 'SPRINT 2015'."),
  measure: z.enum(["RR", "HR", "OR"]).describe("Ratio measure: risk ratio, hazard ratio, or odds ratio."),
  point: z.number().positive().optional().describe("Point estimate on the ratio scale (>0)."),
  ci_lower: z.number().positive().optional().describe("Lower confidence bound (>0)."),
  ci_upper: z.number().positive().optional().describe("Upper confidence bound (>0)."),
  ci_pct: z.number().min(50).max(99.9).optional().describe("CI width percent (default 95)."),
  events1: z.number().int().nonnegative().optional().describe("Treatment-arm events (2x2 form)."),
  total1: z.number().int().positive().optional().describe("Treatment-arm total (2x2 form)."),
  events2: z.number().int().nonnegative().optional().describe("Control-arm events (2x2 form)."),
  total2: z.number().int().positive().optional().describe("Control-arm total (2x2 form)."),
} satisfies z.ZodRawShape;

export const ratioStudy = z.object(ratioStudyFields);

// Ratio study used inside subgroups: the same shape but fields are nullable, so a
// caller can pass explicit nulls for the branch it is not using.
export const nullableRatioStudy = z.object({
  label: z.string().min(1).max(200),
  measure: z.enum(["RR", "HR", "OR"]),
  point: z.number().positive().nullable().optional(),
  ci_lower: z.number().positive().nullable().optional(),
  ci_upper: z.number().positive().nullable().optional(),
  ci_pct: z.number().min(50).max(99.99).nullable().optional(),
  events1: z.number().int().min(0).nullable().optional(),
  total1: z.number().int().min(0).nullable().optional(),
  events2: z.number().int().min(0).nullable().optional(),
  total2: z.number().int().min(0).nullable().optional(),
});

// A pre-computed log-effect + variance point (for regression/dose-response).
export const logPointFields = {
  label: z.string().min(1).max(200).describe("Point label."),
  yi: z.number().finite().describe("Observed log-effect (e.g. ln(RR))."),
  vi: z.number().positive().describe("Variance of the log-effect (>0)."),
} satisfies z.ZodRawShape;

// A network edge: EITHER a pre-pooled { log_effect, variance }, OR studies to pool.
export const networkEdge = z.object({
  log_effect: z.number().finite().optional().describe("Pre-pooled log-scale contrast."),
  variance: z.number().positive().optional().describe("Variance of the pooled log contrast."),
  studies: z.array(ratioStudy).min(1).max(100).optional().describe("Studies to pool into this edge instead."),
});

// Safe getter for building summary lines from an unknown payload.
export function pick(data: unknown, key: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
}

// Build a POST handler: validate args against the tool's own `inputSchema`
// shape, POST to `path`, and return a summary + pretty JSON. Taking the raw
// shape here lets each tool declare its schema exactly once (reused for both the
// MCP inputSchema and this validation). Never throws raw — validation and
// network errors come back as a concise string the model can relay.
export function postHandler(
  path: string,
  shape: z.ZodRawShape,
  summarize: (data: unknown) => string
): PaperTrailTool["handler"] {
  const schema = z.object(shape);
  return async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
    let body: unknown;
    try {
      body = schema.parse(args);
    } catch (err) {
      return toErrorMessage(err);
    }
    try {
      const data = await client.post<unknown>(path, body);
      return formatResult(summarize(data), data);
    } catch (err) {
      return toErrorMessage(err);
    }
  };
}
