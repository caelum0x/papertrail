// PaperTrail MoA v2 — pytrials DESIGN-PRIOR enricher (category: sources).
//
// COMPOSITION ROLE (LAYER 1 · ENRICHER): this agent does NOT vote on the claim. For every
// source that reads like a clinical trial it deterministically infers the trial's structured
// design fields (randomized / blinding / enrollment / phase) from the source's own text, then
// hands them to scoreDesignCredibility (lib/sources/trialDesign.ts) which owns all scoring and
// tiering. It PRODUCES a `design_priors` artifact — a DesignPrior[] of {sourceId, tier,
// priorWeight} — that downstream verification/aggregation agents CONSUME to weight how much a
// trial-shaped source's design strength should count. Because it weights context rather than
// asserting support/refute, its signal is ALWAYS `neutral`.
//
// PRODUCES: ["design_priors"].  CONSUMES: [] — a pure enricher with no upstream dependency.
//
// MOAT: no LLM, no I/O, no DB pool, no network. The parse and the credibility score are pure
// functions of the source text, so the same input always yields the same priors, tiers, and
// grounded phrases. usedClaude is always false. Grounded spans are only ever the verbatim
// design-signal phrases the deterministic probes matched (indexOf-verified substrings).
//
// This UPGRADES backend/moa-v1-adapters/pytrials.ts to the v2 contract: the v1 adapter scored
// only the single most trial-like source; here we score EVERY trial-like source so the produced
// DesignPrior[] covers the whole trial-shaped body of evidence.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  MoaSource,
  DesignPrior,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import {
  parseEligibility,
  scoreDesignCredibility,
  type DesignFieldsInput,
  type DesignCredibility,
} from "../../sources/trialDesign";

const AGENT_ID = "pytrials";

// Gate weight when at least one source clearly reads like a trial. Moderate by spec: a
// design-credibility prior is a supporting weight on a source, not a verdict.
const GATE_TRIAL = 0.6;

// Distinct trial-vocabulary probe hits a source needs to be considered trial-like enough to
// score. One incidental word ("phase of the moon") should not qualify a non-trial source.
const MIN_TRIAL_HITS = 2;

// Cap on grounded design-phrase spans echoed into the contribution, to keep the UI light.
const MAX_GROUNDED_SPANS = 8;

// --- Deterministic trial-likeness probes ---------------------------------------------
//
// Each probe is a documented regex over the source text. They drive BOTH the gate (is any
// source trial-shaped) and the field inference (what to hand the scorer). Case-insensitive;
// none of it is an LLM.

type ProbeKey =
  | "randomized"
  | "doubleBlind"
  | "singleBlind"
  | "openLabel"
  | "placebo"
  | "enrollment"
  | "phase"
  | "eligibility";

interface TrialProbe {
  readonly key: ProbeKey;
  readonly pattern: RegExp;
}

const TRIAL_PROBES: readonly TrialProbe[] = [
  { key: "randomized", pattern: /\brandomi[sz]ed\b/i },
  { key: "doubleBlind", pattern: /\b(?:double|triple|quadruple)[-\s]?blind(?:ed)?\b/i },
  { key: "singleBlind", pattern: /\bsingle[-\s]?blind(?:ed)?\b/i },
  { key: "openLabel", pattern: /\b(?:open[-\s]?label|no\s+masking|unmask)\b/i },
  { key: "placebo", pattern: /\bplacebo\b/i },
  { key: "enrollment", pattern: /\b(?:enroll(?:ed|ment)?|participants?|subjects?|patients?)\b/i },
  { key: "phase", pattern: /\bphase\s*(?:1|2|3|4|i{1,3}|iv)\b/i },
  { key: "eligibility", pattern: /\b(?:eligibility|inclusion\s+criteria|exclusion\s+criteria)\b/i },
];

// Distinct probe keys that actually fired on the text. Pure and cheap.
function firedProbeKeys(text: string): Set<ProbeKey> {
  const fired = new Set<ProbeKey>();
  for (const probe of TRIAL_PROBES) {
    if (probe.pattern.test(text)) fired.add(probe.key);
  }
  return fired;
}

// Count of distinct probe hits — a trial-likeness score for a source. Pure.
function trialLikeness(text: string): number {
  return firedProbeKeys(text).size;
}

// True when a source clearly reads like a clinical trial. Empty text can never qualify.
function isTrialLike(source: MoaSource): boolean {
  const text = source.text ?? "";
  if (text.trim().length === 0) return false;
  return trialLikeness(text) >= MIN_TRIAL_HITS;
}

// --- Deterministic design-field inference from free text -----------------------------
//
// scoreDesignCredibility does all scoring; this only maps text -> the structured fields it
// expects. Absent evidence stays undefined so the scorer deterministically lowers the tier
// rather than anything being guessed.

// Only assert `true` (positive evidence); never assert a false negative from absence.
function inferRandomized(fired: Set<ProbeKey>): boolean | undefined {
  return fired.has("randomized") ? true : undefined;
}

// Map the strongest blinding phrase present to the scorer's string vocabulary. Prefer the
// most rigorous signal when several appear; open-label only when nothing stronger is.
function inferBlinding(fired: Set<ProbeKey>): string | undefined {
  if (fired.has("doubleBlind")) return "double-blind";
  if (fired.has("singleBlind")) return "single-blind";
  if (fired.has("openLabel")) return "open-label";
  return undefined;
}

// Pull the largest explicit "N participants/subjects/patients" or "enrolled N" count.
// Deterministic: scans all matches and keeps the max, so multiple mentions are stable.
const ENROLLMENT_COUNT = new RegExp(
  String.raw`(?:` +
    String.raw`(?:enroll(?:ed|ment)?(?:\s+of)?|randomi[sz]ed|assigned|recruited)\s+(\d[\d,]*)` +
    String.raw`|(\d[\d,]*)\s+(?:participants?|subjects?|patients?|individuals?)` +
    String.raw`)`,
  "gi"
);

function inferEnrollment(text: string): number | undefined {
  let best: number | undefined;
  for (const m of text.matchAll(ENROLLMENT_COUNT)) {
    const raw = m[1] ?? m[2];
    if (raw === undefined) continue;
    const n = Number.parseInt(raw.replace(/,/g, ""), 10);
    if (!Number.isFinite(n)) continue;
    if (best === undefined || n > best) best = n;
  }
  return best;
}

// Map an explicit trial phase to the scorer's uppercase PHASEn vocabulary. Takes the highest
// phase mentioned so combined designs ("Phase 2/3") credit the strongest.
const PHASE_MENTION = /\bphase\s*(1|2|3|4|i{1,3}|iv)\b/gi;

function romanOrArabicToNumber(token: string): number | undefined {
  switch (token.trim().toLowerCase()) {
    case "1":
    case "i":
      return 1;
    case "2":
    case "ii":
      return 2;
    case "3":
    case "iii":
      return 3;
    case "4":
    case "iv":
      return 4;
    default:
      return undefined;
  }
}

function inferPhase(text: string): string | undefined {
  let best: number | undefined;
  for (const m of text.matchAll(PHASE_MENTION)) {
    const token = m[1];
    if (token === undefined) continue;
    const n = romanOrArabicToNumber(token);
    if (n === undefined) continue;
    if (best === undefined || n > best) best = n;
  }
  return best === undefined ? undefined : `PHASE${best}`;
}

function inferDesignFields(text: string, fired: Set<ProbeKey>): DesignFieldsInput {
  const fields: DesignFieldsInput = {};
  const randomized = inferRandomized(fired);
  if (randomized !== undefined) fields.randomized = randomized;
  const blinding = inferBlinding(fired);
  if (blinding !== undefined) fields.blinding = blinding;
  const enrollment = inferEnrollment(text);
  if (enrollment !== undefined) fields.enrollment = enrollment;
  const phase = inferPhase(text);
  if (phase !== undefined) fields.phase = phase;
  return fields;
}

// --- Grounding: verbatim design-signal phrases ---------------------------------------
//
// Only emit a span when a probe's matched text is a real indexOf substring of the source.
// This reuses the phrase the deterministic probe itself matched — nothing is fabricated.

function groundDesignSignals(source: MoaSource, budget: number): GroundedSpan[] {
  const spans: GroundedSpan[] = [];
  const seen = new Set<number>();
  for (const probe of TRIAL_PROBES) {
    if (spans.length >= budget) break;
    const match = source.text.match(probe.pattern);
    if (match === null || match.index === undefined) continue;
    const start = match.index;
    if (seen.has(start)) continue;
    const quote = source.text.slice(start, start + match[0].length);
    // Defensive: only surface a genuine verbatim substring.
    if (source.text.indexOf(quote, start) !== start) continue;
    seen.add(start);
    spans.push({ sourceId: source.id, text: quote, start, end: start + quote.length });
  }
  return spans;
}

// --- Per-source scoring --------------------------------------------------------------

interface ScoredTrial {
  readonly source: MoaSource;
  readonly hits: number;
  readonly fields: DesignFieldsInput;
  readonly credibility: DesignCredibility;
  readonly inclusion: number;
  readonly exclusion: number;
}

function scoreTrial(source: MoaSource): ScoredTrial {
  const fired = firedProbeKeys(source.text);
  const fields = inferDesignFields(source.text, fired);
  const credibility = scoreDesignCredibility(fields);
  const gates = parseEligibility(source.text);
  return {
    source,
    hits: fired.size,
    fields,
    credibility,
    inclusion: gates.inclusion.length,
    exclusion: gates.exclusion.length,
  };
}

// Mean prior weight across the scored trials — the aggregate confidence in the design-prior
// artifact. Empty input yields 0 (handled by the caller before this runs).
function meanPriorWeight(scored: readonly ScoredTrial[]): number {
  const total = scored.reduce((sum, s) => sum + s.credibility.priorWeight, 0);
  return scored.length > 0 ? total / scored.length : 0;
}

function summarize(scored: readonly ScoredTrial[], meanWeight: number): string {
  if (scored.length === 1) {
    const only = scored[0];
    return (
      `1 trial-shaped source reads as ${only.credibility.tierLabel} ` +
      `(prior weight ${only.credibility.priorWeight.toFixed(2)}).`
    );
  }
  return (
    `${scored.length} trial-shaped sources scored for design credibility ` +
    `(mean prior weight ${meanWeight.toFixed(2)}).`
  );
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "pytrials design-prior enricher",
  category: "sources",
  description:
    "Enricher: for every clinical-trial source, deterministically infers design fields " +
    "(randomized / blinding / enrollment / phase) and produces a per-source design-credibility " +
    "prior (tier + weight). Weights source design strength for downstream agents; does not vote.",

  // Enricher: produces the design_priors artifact consumers weight sources with.
  produces: ["design_priors"] as const,
  // Pure enricher: reads no upstream artifact — it works from the input text alone.
  consumes: [] as const,

  // ELIGIBILITY: pure + deterministic over the INPUT only. Moderate when at least one source
  // clearly reads like a trial (>= MIN_TRIAL_HITS distinct trial-vocabulary probes), else 0.
  // No blackboard, no I/O, no LLM, never throws.
  gate(ctx: OrchestrationContext): number {
    for (const source of ctx.sources) {
      if (isTrialLike(source)) return GATE_TRIAL;
    }
    return 0;
  },

  async run(_ctx: OrchestrationContext, _bb: Blackboard): Promise<AgentContribution> {
    try {
      // Pure enricher: it consumes nothing, so there is no bb.get() to compose on. It scores
      // every trial-shaped source in the input and produces the design_priors artifact.
      const trialSources = _ctx.sources.filter(isTrialLike);

      // Honest runtime skip: the router may have boosted the gate, but if no source actually
      // reads like a trial there is no design to score. Not an error.
      if (trialSources.length === 0) {
        return skippedContribution(
          AGENT_ID,
          "No source reads like a clinical trial (needs at least two of: randomized, blinding, placebo, enrollment, phase, eligibility)."
        );
      }

      const scored = trialSources.map(scoreTrial);

      // The produced artifact: one DesignPrior per trial-shaped source. This is what
      // downstream consumers read via bb.get("design_priors").
      const designPriors: DesignPrior[] = scored.map((s) => ({
        sourceId: s.source.id,
        tier: s.credibility.tier,
        priorWeight: s.credibility.priorWeight,
      }));

      const meanWeight = meanPriorWeight(scored);
      // Confidence IS the mean deterministic prior weight across the scored trials.
      const confidence = clamp01(meanWeight);

      // Grounded spans across all scored trials, sharing the global span budget.
      const groundedSpans: GroundedSpan[] = [];
      for (const s of scored) {
        if (groundedSpans.length >= MAX_GROUNDED_SPANS) break;
        const remaining = MAX_GROUNDED_SPANS - groundedSpans.length;
        for (const span of groundDesignSignals(s.source, remaining)) {
          groundedSpans.push(span);
        }
      }

      const detail: Record<string, unknown> = {
        trialSourceCount: scored.length,
        meanPriorWeight: meanWeight,
        perSource: scored.map((s) => ({
          sourceId: s.source.id,
          trialHits: s.hits,
          tier: s.credibility.tier,
          tierLabel: s.credibility.tierLabel,
          priorWeight: s.credibility.priorWeight,
          points: s.credibility.points,
          factors: s.credibility.factors,
          gates: { inclusionCount: s.inclusion, exclusionCount: s.exclusion },
          inferredFields: {
            randomized: s.fields.randomized ?? null,
            blinding: s.fields.blinding ?? null,
            enrollment: s.fields.enrollment ?? null,
            phase: s.fields.phase ?? null,
          },
        })),
      };

      return makeContribution(AGENT_ID, {
        ran: true,
        // Design credibility WEIGHTS sources; it never asserts support/refute.
        signal: "neutral",
        confidence,
        summary: summarize(scored, meanWeight),
        detail,
        groundedSpans,
        usedClaude: false,
        produced: { design_priors: designPriors },
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
