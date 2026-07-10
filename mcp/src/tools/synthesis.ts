// Evidence-synthesis / biostatistics MCP tools.
//
// These wrap PaperTrail's DETERMINISTIC numeric engines — no LLM sits anywhere in
// the numeric path, so identical inputs always yield identical numbers. A
// translational scientist reaches for these to pool trials, probe heterogeneity,
// appraise bias, and decide whether a body of evidence is actually conclusive —
// the questions a single p-value cannot answer. Every tool is read-only and maps
// 1:1 to a live PaperTrail /api endpoint; field names below mirror each route's
// zod schema exactly. Each tool declares its input shape ONCE (reused for the MCP
// inputSchema and the handler's boundary validation).

import { z } from "zod";
import { tool, formatResult, toErrorMessage, type PaperTrailTool } from "../registry.js";
import type { PaperTrailClient } from "../client.js";
import {
  ratioStudy,
  nullableRatioStudy,
  logPointFields,
  networkEdge,
  pick,
  postHandler,
} from "./synthesis.shared.js";

// --- Input shapes (one per tool, matching each route's zod schema) -----------

const metaAnalysisShape = {
  claim: z.string().min(10).max(2000).describe("The efficacy claim to reconcile against the pooled effect."),
  studies: z.array(ratioStudy).min(2).max(100).describe("At least two ratio-scale study effects to pool."),
} satisfies z.ZodRawShape;

const continuousMetaShape = {
  studies: z
    .array(
      z.object({
        label: z.string().min(1).max(200).describe("Study label."),
        meanT: z.number().finite().describe("Treatment-arm mean."),
        sdT: z.number().positive().describe("Treatment-arm SD (>0)."),
        nT: z.number().int().min(2).describe("Treatment-arm n (>=2)."),
        meanC: z.number().finite().describe("Control-arm mean."),
        sdC: z.number().positive().describe("Control-arm SD (>0)."),
        nC: z.number().int().min(2).describe("Control-arm n (>=2)."),
      })
    )
    .min(1)
    .max(200)
    .describe("Two-arm continuous-outcome studies."),
  measure: z.enum(["MD", "SMD"]).default("MD").describe("Mean difference or standardized mean difference."),
} satisfies z.ZodRawShape;

const networkMetaShape = {
  ab: networkEdge.describe("A-vs-B edge (B is the common comparator)."),
  bc: networkEdge.describe("B-vs-C edge (B is the common comparator)."),
  direct: networkEdge.optional().describe("Optional direct A-vs-C edge for a consistency check."),
} satisfies z.ZodRawShape;

const metaRegressionShape = {
  points: z
    .array(z.object(logPointFields).extend({ x: z.number().finite().describe("Moderator value.") }))
    .min(3)
    .max(200)
    .describe("Study points with a moderator x (>=3 points, >=2 distinct x)."),
  moderator: z.string().min(1).max(120).optional().describe("Name of the moderator, echoed back."),
  claim: z.string().min(1).max(2000).optional().describe("Optional claim context (never logged)."),
  residualHeterogeneity: z.boolean().optional().describe("Include a residual tau-squared term (mixed-effects)."),
} satisfies z.ZodRawShape;

const subgroupShape = {
  claim: z.string().min(10).max(2000).describe("The claim to check against the subgroup structure."),
  subgroups: z
    .array(z.object({ name: z.string().min(1).max(200), studies: z.array(nullableRatioStudy).min(1).max(100) }))
    .min(1)
    .max(20)
    .describe("One or more named subgroups, each with its own studies."),
} satisfies z.ZodRawShape;

const survivalShape = {
  claim: z.string().min(10).max(2000).describe("The survival / time-to-event claim."),
  hazardRatio: z.number().positive().optional().describe("Reported hazard ratio (>0)."),
  hrCiLower: z.number().positive().optional().describe("HR lower CI bound."),
  hrCiUpper: z.number().positive().optional().describe("HR upper CI bound."),
  medianTreatment: z.number().positive().optional().describe("Treatment-arm median survival."),
  medianControl: z.number().positive().optional().describe("Control-arm median survival."),
  survivalControl: z.number().min(0).max(1).optional().describe("Control-arm KM survival prob (0..1) at timepoint."),
  survivalTreatment: z.number().min(0).max(1).optional().describe("Treatment-arm KM survival prob (0..1) at timepoint."),
  timepoint: z.number().positive().optional().describe("Landmark timepoint for the KM probabilities."),
} satisfies z.ZodRawShape;

const doseResponseShape = {
  points: z
    .array(z.object(logPointFields).extend({ dose: z.number().finite().describe("Dose level for this point.") }))
    .min(3)
    .max(200)
    .describe("Dose-stratified points (>=3 points, >=2 distinct doses)."),
  doseUnit: z.string().min(1).max(60).optional().describe("Dose axis unit, e.g. 'mg/day' (echoed back)."),
  claim: z.string().min(1).max(2000).optional().describe("Optional claim context (never logged)."),
} satisfies z.ZodRawShape;

const riskOfBiasShape = {
  randomSequenceGenerated: z.boolean().describe("Was a genuine random sequence generated?"),
  allocationConcealed: z.boolean().describe("Was the upcoming assignment hidden from enrollers?"),
  blinding: z
    .enum(["double_blind", "single_blind", "open_label", "unclear"])
    .describe("Blinding of participants/personnel."),
  outcomeAssessorBlinded: z.boolean().describe("Was the outcome assessor blinded?"),
  outcomeType: z.enum(["objective", "subjective"]).describe("Objective outcomes are robust to lack of blinding."),
  attritionRate: z.number().min(0).max(1).describe("Overall dropout proportion (0..1)."),
  intentionToTreat: z.boolean().describe("Was the analysis intention-to-treat?"),
  preRegistered: z.boolean().describe("Was the trial pre-registered?"),
  allPrespecifiedOutcomesReported: z.boolean().describe("Were all pre-specified primary outcomes reported?"),
  sampleSize: z.number().int().positive().nullable().optional().describe("Total sample size (pragmatic flag)."),
  stoppedEarlyForBenefit: z.boolean().optional().describe("Was the trial stopped early for benefit?"),
  funding: z.enum(["public", "mixed", "industry_only", "unclear"]).optional().describe("Funding source."),
} satisfies z.ZodRawShape;

const evidenceReportShape = {
  claim: z.string().min(10).max(2000).describe("The claim to appraise."),
  studies: z.array(ratioStudy).min(1).max(100).describe("Ratio-scale trial effects to pool and appraise."),
  risk_of_bias_steps: z.number().int().min(0).max(2).optional().describe("GRADE risk-of-bias downgrade steps (0-2)."),
  indirectness_steps: z.number().int().min(0).max(2).optional().describe("GRADE indirectness downgrade steps (0-2)."),
  baselineRisk: z.number().gt(0).lt(1).optional().describe("Assumed control-arm risk in (0,1) for absolute effects."),
} satisfies z.ZodRawShape;

const evidencePipelineShape = {
  claim: z.string().min(10).max(2000).describe("The efficacy claim to verify against the literature."),
  query: z.string().min(1).max(2000).optional().describe("Optional search-steering query; defaults to the claim text."),
  limit: z.number().int().min(1).max(20).optional().describe("Max candidate sources to retrieve (1-20)."),
} satisfies z.ZodRawShape;

// trial_sequential is a discriminated union on `mode`; its handler forwards only
// the supplied fields, so its inputSchema lists every branch's fields as optional.
const trialSequentialShape = {
  mode: z.enum(["ris", "boundary", "verdict"]).describe("Which analysis to run."),
  controlRisk: z.number().gt(0).lt(1).optional().describe("[ris] Control-arm event risk in (0,1)."),
  relativeRiskReduction: z.number().gt(0).lt(1).optional().describe("[ris] Target relative risk reduction in (0,1)."),
  iSquared: z.number().min(0).max(0.999).optional().describe("[ris] Heterogeneity for diversity adjustment."),
  informationFraction: z.number().gt(0).lte(1).optional().describe("[boundary] Fraction of RIS accrued (0,1]."),
  accruedN: z.number().nonnegative().optional().describe("[verdict] Participants accrued so far."),
  ris: z.number().positive().optional().describe("[verdict] Required Information Size."),
  cumulativeZ: z.number().finite().optional().describe("[verdict] Cumulative Z statistic."),
  alpha: z.number().gt(0).lt(1).optional().describe("Two-sided alpha (default 0.05)."),
  power: z.number().gt(0).lt(1).optional().describe("[ris] Desired power (default 0.8)."),
} satisfies z.ZodRawShape;

// --- Tools ------------------------------------------------------------------

export const synthesisTools: PaperTrailTool[] = [
  tool({
    name: "meta_analysis",
    title: "Meta-analysis (pool ratio effects vs a claim)",
    description:
      "Pool two or more randomized-trial effect estimates (RR/HR/OR, given as point+CI or 2x2 counts) into " +
      "fixed-effect and random-effects summaries with Q, I-squared, tau-squared heterogeneity and a prediction " +
      "interval, then compare a stated claim's magnitude against the pooled effect. Use when a reviewer says " +
      "'Drug X cuts events by 30%' and you need to check whether the pooled trial evidence supports that " +
      "magnitude. Deterministic — no LLM in the numeric path.",
    inputSchema: metaAnalysisShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/synthesis", metaAnalysisShape, (d) => {
      const verdict = pick(pick(d, "verdict"), "verdict") ?? "unknown";
      const k = pick(pick(d, "pooled"), "k") ?? "?";
      return `Meta-analysis of ${String(k)} studies. Verdict vs claim: ${String(verdict)}.`;
    }),
  }),

  tool({
    name: "continuous_meta_analysis",
    title: "Continuous-outcome meta-analysis (MD / SMD)",
    description:
      "Pool two-arm studies reporting a CONTINUOUS endpoint (mean, SD and n per arm — e.g. blood-pressure change, " +
      "pain score) on the mean-difference (MD) or standardized mean difference / Hedges' g (SMD) scale, with " +
      "fixed- and random-effects summaries and Q / I-squared / tau-squared heterogeneity around a null of 0. Use " +
      "when the outcome is a measured quantity rather than an event count. Deterministic.",
    inputSchema: continuousMetaShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/continuous-meta", continuousMetaShape, (d) => {
      const k = pick(d, "k") ?? "?";
      const sig = pick(pick(d, "random"), "significant");
      return `Continuous meta-analysis of ${String(k)} studies. Random-effects significant: ${String(sig)}.`;
    }),
  }),

  tool({
    name: "network_meta_analysis",
    title: "Network / indirect meta-analysis (Bucher)",
    description:
      "Estimate an A-vs-C treatment effect INDIRECTLY through a common comparator B using the Bucher method: supply " +
      "the A-vs-B and B-vs-C edges (each a pre-pooled log_effect+variance or a set of studies to pool). If a direct " +
      "A-vs-C edge is also given, it is inverse-variance combined with the indirect estimate and an incoherence " +
      "(inconsistency) test is reported. Use to compare two drugs never tested head-to-head. Deterministic.",
    inputSchema: networkMetaShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/network-meta", networkMetaShape, (d) => {
      const ind = pick(d, "indirect");
      return `Indirect A-vs-C estimate: ${String(pick(ind, "point"))} (significant: ${String(pick(ind, "significant"))}).`;
    }),
  }),

  tool({
    name: "meta_regression",
    title: "Meta-regression (explain heterogeneity by a moderator)",
    description:
      "Fit study-level effects (log-effect yi + variance vi) against a study-level moderator x — dose, baseline " +
      "risk, publication year — by inverse-variance weighted least squares with a mixed-effects (DerSimonian–Laird) " +
      "residual tau-squared. A significant slope means the moderator drives the effect and explains part of the " +
      "heterogeneity. Needs >=3 studies with >=2 distinct moderator values. Use to test whether an effect depends " +
      "on a covariate. Deterministic.",
    inputSchema: metaRegressionShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/meta-regression", metaRegressionShape, (d) => {
      return `Meta-regression slope: ${String(pick(d, "slope"))} (significant: ${String(pick(d, "slopeSignificant"))}).`;
    }),
  }),

  tool({
    name: "subgroup_analysis",
    title: "Subgroup analysis (is the claim a single-subgroup artefact?)",
    description:
      "Pool each named subgroup (each a set of ratio-scale study effects), run the deterministic test for subgroup " +
      "differences (Q-between, interaction p-value), and return a verdict on whether a claim rests on ONE subgroup " +
      "rather than the overall trial effect. Use to catch cherry-picked subgroup findings dressed up as the " +
      "headline result. Deterministic.",
    inputSchema: subgroupShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/subgroup", subgroupShape, (d) => {
      const sig = pick(d, "interactionSignificant");
      const verdict = pick(pick(d, "verdict"), "verdict") ?? "unknown";
      return `Subgroup interaction significant: ${String(sig)}. Verdict: ${String(verdict)}.`;
    }),
  }),

  tool({
    name: "survival_analysis",
    title: "Survival / time-to-event reconciliation",
    description:
      "Reconcile a time-to-event claim against reported survival statistics: a hazard ratio + CI, per-arm median " +
      "survival times (deterministic median ratio), and/or Kaplan–Meier survival probabilities at a landmark " +
      "timepoint (absolute risk reduction and NNT). Use to check claims like 'improved median survival by 4 months' " +
      "or 'halved the risk of death'. Deterministic.",
    inputSchema: survivalShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/survival", survivalShape, (d) => {
      const verdict = pick(pick(d, "reconciliation"), "verdict") ?? "unknown";
      return `Survival reconciliation verdict: ${String(verdict)}.`;
    }),
  }),

  tool({
    name: "dose_response_analysis",
    title: "Dose-response trend test",
    description:
      "Fit a linear dose-response trend across dose-stratified effect estimates (each a log-effect yi + variance vi " +
      "at a dose level, all vs a COMMON reference) by inverse-variance weighted least squares and test the slope " +
      "against zero. A significant slope means 'more drug -> more effect' — a gradient single-comparison checkers " +
      "miss. Needs >=3 points across >=2 distinct doses. Deterministic.",
    inputSchema: doseResponseShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/dose-response", doseResponseShape, (d) => {
      const trend = pick(d, "trend") ?? "unknown";
      return `Dose-response trend: ${String(trend)} (slope significant: ${String(pick(d, "slopeSignificant"))}).`;
    }),
  }),

  tool({
    name: "trial_sequential_analysis",
    title: "Trial sequential analysis (is the evidence conclusive?)",
    description:
      "Answer the question a generic significance test cannot: is the pooled evidence CONCLUSIVE, or is more data " +
      "still needed? Three modes. mode='ris' computes the Required Information Size for a definitive body of " +
      "evidence (from control risk, relative risk reduction, alpha, power, optional I-squared). mode='boundary' " +
      "returns the O'Brien–Fleming alpha-spending Z boundary at an information fraction. mode='verdict' classifies " +
      "accrued evidence as conclusive_benefit / conclusive_no_effect / insufficient. Deterministic.",
    inputSchema: trialSequentialShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      // The route validates a discriminated union on `mode`; forward only the
      // fields the caller supplied so each branch's schema sees a clean body.
      const mode = args.mode;
      if (mode !== "ris" && mode !== "boundary" && mode !== "verdict") {
        return "Invalid input for \"mode\": expected 'ris', 'boundary', or 'verdict'.";
      }
      const body: Record<string, unknown> = { mode };
      const forward = [
        "controlRisk",
        "relativeRiskReduction",
        "iSquared",
        "informationFraction",
        "accruedN",
        "ris",
        "cumulativeZ",
        "alpha",
        "power",
      ];
      for (const key of forward) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      try {
        const data = await client.post<unknown>("/api/trial-sequential", body);
        const verdict = pick(data, "verdict");
        const summary =
          mode === "verdict"
            ? `Trial sequential verdict: ${String(verdict ?? "n/a")}.`
            : `Trial sequential (${mode}) computed.`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "risk_of_bias",
    title: "Risk-of-bias appraisal (Cochrane RoB 2 style)",
    description:
      "Assess a single randomized trial from explicit, reviewer-answerable facts (randomization, allocation " +
      "concealment, blinding, attrition/ITT, selective reporting, plus pragmatic flags) and return per-domain " +
      "judgements, an overall judgement, and the GRADE downgrade step count. Use before pooling to appraise each " +
      "trial's internal validity. Deterministic rules — no LLM.",
    inputSchema: riskOfBiasShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/risk-of-bias", riskOfBiasShape, (d) => {
      const overall = pick(d, "overall") ?? "unknown";
      return `Overall risk of bias: ${String(overall)} (GRADE downgrade steps: ${String(pick(d, "gradeSteps") ?? "?")}).`;
    }),
  }),

  tool({
    name: "evidence_report",
    title: "Composite evidence report (pool -> bias -> GRADE -> verdict)",
    description:
      "Chain the deterministic engines into one defensible object: meta-analysis of the supplied ratio-scale trial " +
      "effects, Egger's publication-bias test, GRADE certainty rating, and the claim-vs-pool verdict — optionally " +
      "translated into absolute effects (ARR / NNT / events per 1000) when a baseline risk is given. Supply your " +
      "own risk-of-bias and indirectness downgrade steps; publication bias is computed, not declared. Use to " +
      "produce a full appraisal of a claim from a study list you already have. Deterministic.",
    inputSchema: evidenceReportShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: postHandler("/api/evidence-report", evidenceReportShape, (d) => {
      const certainty = pick(pick(d, "certainty"), "certainty");
      const verdict = pick(pick(d, "verdict"), "verdict");
      return `Evidence report — GRADE certainty: ${String(certainty ?? "n/a")}, verdict: ${String(verdict ?? "n/a")}.`;
    }),
  }),

  tool({
    name: "evidence_pipeline",
    title: "End-to-end evidence pipeline (claim in, full report out)",
    description:
      "Give a plain-language efficacy claim and PaperTrail finds its OWN primary sources (PubMed / " +
      "ClinicalTrials.gov), extracts the effect estimates, pools them, and returns the same composite evidence " +
      "report as evidence_report — no study list required from you. Optionally steer retrieval with a query and " +
      "cap the number of candidate sources. Use this as the one-call path from a claim to a defensible appraisal. " +
      "Reaches live external registries; the numeric loop is still deterministic.",
    inputSchema: evidencePipelineShape,
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: postHandler("/api/evidence-pipeline", evidencePipelineShape, (d) => {
      const used = pick(d, "usedSources");
      const n = Array.isArray(used) ? used.length : "?";
      const reportOk = pick(pick(d, "report"), "ok");
      return `Evidence pipeline used ${String(n)} sources (report usable: ${String(reportOk)}).`;
    }),
  }),
];
