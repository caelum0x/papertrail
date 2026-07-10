// RESEARCH-GAP ANALYSIS + TESTABLE-HYPOTHESIS GENERATION (AI-Scientist-style, grounded).
//
// The premise: a generic LLM asked "where are the gaps in the evidence for X?" will
// happily hallucinate heterogeneity, missing populations, or wide CIs that the actual
// literature doesn't show. This engine refuses to let it. The flow is:
//
//   1. GROUND FIRST (deterministic). Run runEvidencePipeline (lib/evidencePipeline) to
//      find the primary sources and pool them into a composite evidence report
//      (meta-analysis → publication-bias → GRADE → verdict). NO LLM in that numeric loop.
//   2. DERIVE SIGNALS (deterministic). Read the report and extract the gap-relevant facts
//      it ALREADY established — high I², wide/ null-crossing CIs, few studies, low GRADE
//      certainty, Egger's asymmetry, claim-vs-pool mismatch, or an honest no-support-found.
//      Each signal carries the concrete engine numbers behind it (I²=…, CI=…, k=…).
//   3. REASON (Claude). Hand Claude ONLY those grounded signals and let it reason over
//      what the pooled evidence does and does NOT establish — proposing research gaps and
//      testable hypotheses, each tied to a specific signal. callClaudeForJson + Zod.
//   4. ENFORCE GROUNDING (deterministic). Drop any gap/hypothesis whose signal_id isn't a
//      real derived signal. Claude may reason over the evidence base; it may NOT invent a
//      finding the engine didn't produce. Dropped items are counted, never hidden.
//
// Claude does the genuinely hard part — synthesising heterogeneous signals into sharp,
// falsifiable hypotheses aimed at a translational-research audience — but every gap it
// raises is anchored to a number a reviewer can check. This file performs no direct DB
// or network I/O; retrieval + the Claude call are injectable so tests run offline.

import type { Pool } from "pg";
import {
  runEvidencePipeline,
  type EvidencePipelineResult,
  type SourceRetriever,
} from "../evidencePipeline";
import type { BuildEvidenceReportResult } from "../evidenceReport";
import { I2_INCONSISTENCY_THRESHOLD } from "../grade";
import { callClaudeForJson } from "../claude";
import {
  HypothesesInputSchema,
  HypothesesLlmOutputSchema,
  type EvidenceSignal,
  type HypothesesInput,
  type HypothesesLlmOutput,
  type HypothesesResult,
  type UsedSourceRef,
} from "./schemas";

// A wide ratio CI: the pooled upper bound is an appreciable multiple of the lower bound.
// Same conventional cut-point GRADE's imprecision rule uses (grade.RATIO_CI_WIDE_FACTOR),
// re-stated locally so this file owns its gap threshold explicitly.
const WIDE_CI_FACTOR = 3;

// Below this pooled study count the body of evidence is fragile (no prediction interval
// is even defined below 3 studies) — a coverage gap in its own right.
const FEW_STUDIES_MAX = 3;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// SIGNAL DERIVATION — pure. Read the deterministic report and emit the gap-relevant
// facts it already established. Every signal's `metrics` carries the concrete engine
// numbers so nothing downstream has to re-derive (or guess) them.
// ---------------------------------------------------------------------------
export function deriveSignals(report: BuildEvidenceReportResult): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];

  // Honest no-support-found: retrieval + extraction assembled no poolable body of
  // evidence. This is itself the most important gap — the claim/topic is under-studied
  // (or unindexed) in the cached primary sources. Nothing else can be derived.
  if (!report.ok) {
    signals.push({
      id: "sig-no-support",
      kind: "no_support_found",
      detail:
        report.reason ||
        "No poolable body of primary evidence was assembled for this topic, so the pooled effect, heterogeneity, and certainty could not be computed.",
      metrics: { usableStudies: report.usableStudies },
    });
    return signals;
  }

  const pooled = report.pooled;
  const random = pooled.random;
  const het = pooled.heterogeneity;

  // Few studies: fragile pool, no prediction interval below three studies.
  if (pooled.k <= FEW_STUDIES_MAX) {
    signals.push({
      id: "sig-few-studies",
      kind: "few_studies",
      detail: `Only ${pooled.k} ${pooled.measure} ${pooled.k === 1 ? "study" : "studies"} could be pooled, so the summary effect rests on a thin, fragile evidence base${pooled.k < 3 ? " and no 95% prediction interval is defined" : ""}.`,
      metrics: { k: pooled.k, measure: pooled.measure },
    });
  }

  // High between-study heterogeneity — the effect is not consistent across trials, which
  // usually points at an unexplained population/dose/endpoint moderator worth testing.
  if (het.iSquared >= I2_INCONSISTENCY_THRESHOLD) {
    signals.push({
      id: "sig-heterogeneity",
      kind: "high_heterogeneity",
      detail: `Between-study heterogeneity is substantial (I²=${round(het.iSquared, 1)}%, threshold ${I2_INCONSISTENCY_THRESHOLD}%): the ${pooled.measure} effect is not consistent across the pooled trials, suggesting an unexplained moderator.`,
      metrics: { iSquared: round(het.iSquared, 1), tauSquared: het.tauSquared, k: pooled.k },
    });
  }

  // Pooled CI crosses the null — the effect is not statistically established.
  if (!random.significant) {
    signals.push({
      id: "sig-crosses-null",
      kind: "crosses_null",
      detail: `The pooled 95% CI (${random.ciLower}–${random.ciUpper}) includes the null of 1, so the summary ${pooled.measure} does not establish a benefit at conventional significance.`,
      metrics: { point: random.point, ciLower: random.ciLower, ciUpper: random.ciUpper },
    });
  }

  // Wide CI — imprecise even if it excludes the null.
  if (random.ciLower > 0 && random.ciUpper >= random.ciLower * WIDE_CI_FACTOR) {
    signals.push({
      id: "sig-wide-ci",
      kind: "wide_confidence_interval",
      detail: `The pooled 95% CI is wide (${random.ciLower}–${random.ciUpper}; upper bound ≥ ${WIDE_CI_FACTOR}× the lower): the magnitude of the ${pooled.measure} effect is imprecisely estimated.`,
      metrics: { ciLower: random.ciLower, ciUpper: random.ciUpper },
    });
  }

  // Egger's asymmetry — possible small-study / publication bias.
  if (report.publicationBias.verdict === "possible_small_study_effects") {
    signals.push({
      id: "sig-pub-bias",
      kind: "publication_bias",
      detail: report.publicationBias.note,
      metrics: {
        intercept: report.publicationBias.test?.intercept ?? "n/a",
        pValue: report.publicationBias.test?.pValue ?? "n/a",
      },
    });
  }

  // Low GRADE certainty — the body of evidence is weak regardless of the point estimate.
  if (report.certainty.certainty === "low" || report.certainty.certainty === "very_low") {
    signals.push({
      id: "sig-low-certainty",
      kind: "low_certainty",
      detail: `GRADE certainty in this body of evidence is ${report.certainty.certainty} (${report.certainty.downgrades.map((d) => d.domain).join(", ") || "downgraded"}), so conclusions drawn from the pool are correspondingly weak.`,
      metrics: { certainty: report.certainty.certainty, downgrades: report.certainty.downgrades.length },
    });
  }

  // The claim's own magnitude disagrees with what the pool supports.
  if (
    report.verdict.verdict === "overstates_pooled" ||
    report.verdict.verdict === "understates_pooled" ||
    report.verdict.verdict === "significance_mismatch" ||
    report.verdict.verdict === "single_trial_cherry_pick"
  ) {
    signals.push({
      id: "sig-claim-mismatch",
      kind: "claim_pool_mismatch",
      detail: `The topic/claim's implied magnitude disagrees with the pooled effect (${report.verdict.verdict.replace(/_/g, " ")})${report.verdict.pooledReductionPercent !== null ? ` (pooled ≈ ${round(report.verdict.pooledReductionPercent, 1)}% reduction)` : ""}: ${report.verdict.rationale}`,
      metrics: {
        verdict: report.verdict.verdict,
        claimedReductionPercent: report.verdict.claimedReductionPercent ?? "n/a",
        pooledReductionPercent: report.verdict.pooledReductionPercent ?? "n/a",
      },
    });
  }

  return signals;
}

function toUsedSourceRefs(pipeline: EvidencePipelineResult): UsedSourceRef[] {
  return pipeline.usedSources.map((s) => ({
    id: s.id,
    title: s.title,
    source_type: s.source_type,
  }));
}

// The system prompt makes the grounding contract explicit to the model: reason ONLY over
// the supplied signals, cite one by id per gap, never invent a finding.
const SYSTEM_PROMPT = `You are a translational-research methodologist analysing a body of clinical-trial evidence for a disease-focused lab. You are given a topic and a set of DETERMINISTIC evidence signals that a biostatistics engine has ALREADY computed from the pooled primary sources (heterogeneity, confidence-interval width, study count, GRADE certainty, publication-bias tests, claim-vs-pool agreement, or an honest "no support found").

Your job: surface where this evidence is thin, absent, or conflicting, and propose TESTABLE, falsifiable hypotheses that would address each gap.

HARD RULES — you will be audited against them:
- Reason ONLY over the supplied signals. Do NOT invent findings, numbers, populations, or endpoints that are not implied by a signal.
- Every gap MUST set signal_id to the id of exactly one supplied signal. A gap that cites no real signal is discarded.
- Every hypothesis MUST set signal_id to a supplied signal id and be genuinely testable: a falsifiable prediction plus a plausible study design.
- Do not restate the signal — explain, for a translational-research audience, what the pooled evidence does NOT establish and why that is a scientifically actionable gap.
- If the only signal is "no_support_found", treat the ABSENCE of evidence as the gap: propose the primary studies that would need to exist.

Return ONLY a JSON object of the form:
{"gaps":[{"signal_id":"...","title":"...","why_gap":"...","affected_population":"... or null"}],"hypotheses":[{"signal_id":"...","statement":"...","testable_prediction":"...","suggested_design":"...","rationale":"..."}],"synthesis":"2-4 sentence overview of what the evidence base does and does not establish."}`;

function buildUserPrompt(topic: string, signals: EvidenceSignal[]): string {
  const lines = signals.map(
    (s) => `- id=${s.id} kind=${s.kind} :: ${s.detail} [metrics: ${JSON.stringify(s.metrics)}]`
  );
  return [
    `TOPIC: ${topic}`,
    "",
    "DETERMINISTIC EVIDENCE SIGNALS (the only facts you may reason from):",
    ...lines,
    "",
    "Produce grounded research gaps and testable hypotheses per the rules. JSON only.",
  ].join("\n");
}

// A Claude caller narrowed to this engine's contract, injectable so tests run offline.
export type HypothesesLlm = (params: {
  system: string;
  user: string;
}) => Promise<HypothesesLlmOutput>;

const defaultLlm: HypothesesLlm = (params) =>
  callClaudeForJson({
    system: params.system,
    user: params.user,
    schema: HypothesesLlmOutputSchema,
    maxTokens: 2048,
  });

// Keep only gaps/hypotheses whose signal_id is a real derived signal — the grounding
// gate. Returns the filtered set plus how many were dropped (surfaced for transparency).
function enforceGrounding(
  output: HypothesesLlmOutput,
  signalIds: ReadonlySet<string>
): { gaps: HypothesesLlmOutput["gaps"]; hypotheses: HypothesesLlmOutput["hypotheses"]; dropped: number } {
  const gaps = output.gaps.filter((g) => signalIds.has(g.signal_id));
  const hypotheses = output.hypotheses.filter((h) => signalIds.has(h.signal_id));
  const dropped =
    output.gaps.length - gaps.length + (output.hypotheses.length - hypotheses.length);
  return { gaps, hypotheses, dropped };
}

/**
 * Generate grounded research gaps + testable hypotheses for a topic/claim.
 *
 * Grounds first: runs the deterministic evidence pipeline to pool the primary sources,
 * derives the gap-relevant signals the engine established, hands ONLY those signals to
 * Claude, then drops any gap/hypothesis Claude produced that doesn't cite a real signal.
 * Claude does the reasoning; the engine guarantees every gap is anchored to a checkable
 * number. Pure orchestration — no direct DB/network I/O; retrieval and the Claude call
 * are injectable so tests run without embeddings, a DB, or the Anthropic API.
 */
export async function generateHypotheses(
  pool: Pool,
  input: HypothesesInput,
  opts?: { retrieve?: SourceRetriever; llm?: HypothesesLlm }
): Promise<HypothesesResult> {
  const parsed = HypothesesInputSchema.parse(input);
  const topic = parsed.topic;

  // 1-2. Ground: pool the evidence, then derive the deterministic signals.
  const pipeline = await runEvidencePipeline(
    pool,
    { claim: topic, query: parsed.query, limit: parsed.limit },
    opts?.retrieve ? { retrieve: opts.retrieve } : undefined
  );
  const signals = deriveSignals(pipeline.report);
  const signalIds = new Set(signals.map((s) => s.id));
  const evidenceGrounded = pipeline.report.ok;
  const usedSources = toUsedSourceRefs(pipeline);

  // 3. Reason: Claude over the grounded signals only.
  const llm = opts?.llm ?? defaultLlm;
  const raw = await llm({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(topic, signals),
  });

  // 4. Enforce grounding: drop anything not anchored to a real signal.
  const { gaps, hypotheses, dropped } = enforceGrounding(raw, signalIds);

  return {
    topic,
    evidenceGrounded,
    signals,
    gaps,
    hypotheses,
    synthesis: raw.synthesis,
    usedSources,
    droppedUngrounded: dropped,
  };
}
