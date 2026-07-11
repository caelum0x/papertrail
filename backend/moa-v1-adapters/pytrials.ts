// MoA expert adapter — pytrials trial-design credibility prior (category: sources).
//
// WHAT IT CONTRIBUTES: a WEIGHTING signal on how credible a clinical trial's DESIGN is,
// derived only from the source's own text. It does NOT vote on whether the claim is
// true; it tells the aggregator how much to trust a trial-shaped source's design
// strength (randomized? blinded? big enough? late enough phase?). Because it weights
// context rather than asserting support/refute, its signal is ALWAYS `neutral`.
//
// Engine lib: lib/sources/trialDesign.ts::parseEligibility + scoreDesignCredibility.
//   - Both are PURE and LLM-free. This adapter deterministically INFERS the structured
//     design fields (randomized / blinding / enrollment / phase) from the source text
//     with simple, documented regex probes, then hands them to scoreDesignCredibility,
//     which owns all scoring/tiering. The same source text always yields the same tier,
//     prior weight, and factors.
//   - Stateless: no DB pool, no network, no Claude. usedClaude is always false.
//   - Grounding: the only quotes surfaced are the verbatim design-signal phrases the
//     probes matched (indexOf-verified substrings of the source text). Never fabricated.
//
// GATING: moderate (~0.6) when the single most trial-like source clearly reads like a
// clinical trial (randomized / double-blind / placebo / enrollment / phase / eligibility
// vocabulary present), else 0 — a design-credibility prior for a non-trial source is not
// honest MoE work.

import type {
  Expert,
  OrchestrationContext,
  ExpertContribution,
  GroundedSpan,
  MoaSource,
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

const EXPERT_ID = "pytrials";

// Gate weight when the best source clearly reads like a trial. Moderate by spec: a
// design-credibility prior is a supporting weight on one source, not a verdict.
const GATE_TRIAL = 0.6;

// Number of distinct trial-vocabulary hits a source needs to be considered trial-like
// enough to score. One incidental word ("phase of the moon") should not qualify.
const MIN_TRIAL_HITS = 2;

// Cap on grounded design-phrase spans echoed into the contribution, to keep the UI light.
const MAX_GROUNDED_SPANS = 8;

// --- Deterministic trial-likeness probes ---------------------------------------------
//
// Each probe is a documented regex over the source text. They drive BOTH the gate (how
// trial-shaped is the best source) and the field inference (what to hand the scorer).
// All matching is case-insensitive; none of it is an LLM.

interface TrialProbe {
  readonly key:
    | "randomized"
    | "doubleBlind"
    | "singleBlind"
    | "openLabel"
    | "placebo"
    | "enrollment"
    | "phase"
    | "eligibility";
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
function firedProbeKeys(text: string): Set<TrialProbe["key"]> {
  const fired = new Set<TrialProbe["key"]>();
  for (const probe of TRIAL_PROBES) {
    if (probe.pattern.test(text)) fired.add(probe.key);
  }
  return fired;
}

// A trial-likeness score for a source: count of distinct probe hits. Pure.
function trialLikeness(text: string): number {
  return firedProbeKeys(text).size;
}

// --- Deterministic design-field inference from free text -----------------------------
//
// scoreDesignCredibility does all scoring; this only maps text -> the structured fields
// it expects. Absent evidence stays undefined so the scorer deterministically lowers the
// tier rather than anything being guessed.

// Detect a randomized design. We only assert `true` (positive evidence); we never assert
// a false negative from absence, so a missing signal stays undefined ("not reported").
function inferRandomized(fired: Set<TrialProbe["key"]>): boolean | undefined {
  return fired.has("randomized") ? true : undefined;
}

// Map the strongest blinding phrase present to the scorer's string vocabulary. Prefer
// the most rigorous signal when several appear; open-label only when nothing stronger is.
function inferBlinding(fired: Set<TrialProbe["key"]>): string | undefined {
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

// Map an explicit trial phase to the scorer's uppercase PHASEn vocabulary. Takes the
// latest (highest) phase mentioned so combined designs ("Phase 2/3") credit the strongest.
const PHASE_MENTION = /\bphase\s*(1|2|3|4|i{1,3}|iv)\b/gi;

function romanOrArabicToNumber(token: string): number | undefined {
  const t = token.trim().toLowerCase();
  switch (t) {
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

function inferDesignFields(text: string, fired: Set<TrialProbe["key"]>): DesignFieldsInput {
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

// --- Grounding: verbatim design-signal phrases -----------------------------------------
//
// Only emit a span when a probe's matched text is a real indexOf substring of the source.
// This reuses the phrase the deterministic probe itself matched — nothing is fabricated.

function groundDesignSignals(source: MoaSource): GroundedSpan[] {
  const spans: GroundedSpan[] = [];
  const seen = new Set<number>();
  for (const probe of TRIAL_PROBES) {
    if (spans.length >= MAX_GROUNDED_SPANS) break;
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

// --- Best-source selection ------------------------------------------------------------

interface RankedSource {
  readonly source: MoaSource;
  readonly hits: number;
}

// The single most trial-like source (highest distinct-probe count). Ties break on source
// order for determinism. Sources without text can never qualify.
function mostTrialLike(sources: readonly MoaSource[]): RankedSource | undefined {
  let best: RankedSource | undefined;
  for (const source of sources) {
    if (source.text.trim().length === 0) continue;
    const hits = trialLikeness(source.text);
    if (best === undefined || hits > best.hits) best = { source, hits };
  }
  return best;
}

// --- UI summary -----------------------------------------------------------------------

function summarize(credibility: DesignCredibility, inclusion: number, exclusion: number): string {
  const gates =
    inclusion + exclusion > 0
      ? ` Parsed ${inclusion} inclusion / ${exclusion} exclusion gate(s).`
      : "";
  return (
    `Trial design reads as ${credibility.tierLabel} ` +
    `(prior weight ${credibility.priorWeight.toFixed(2)}, ${credibility.points} pts).${gates}`
  );
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "pytrials design-credibility prior",
  category: "sources",
  description:
    "Weights a clinical-trial source by its DESIGN strength (randomized / blinding / " +
    "enrollment / phase) plus an eligibility-gate parse. Weights source credibility; " +
    "does not vote on the claim.",

  // Pure + deterministic: moderate when the best source clearly reads like a trial
  // (>= MIN_TRIAL_HITS distinct trial-vocabulary probes), 0 otherwise. No I/O, no LLM.
  gate(ctx: OrchestrationContext): number {
    const best = mostTrialLike(ctx.sources);
    if (best === undefined) return 0;
    return best.hits >= MIN_TRIAL_HITS ? GATE_TRIAL : 0;
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    try {
      const best = mostTrialLike(ctx.sources);

      // Honest runtime skip: the router may have boosted the gate, but if no source
      // actually reads like a trial there is no design to score. Not an error.
      if (best === undefined || best.hits < MIN_TRIAL_HITS) {
        return skippedContribution(
          EXPERT_ID,
          "No source reads like a clinical trial (needs at least two of: randomized, blinding, placebo, enrollment, phase, eligibility)."
        );
      }

      const { source } = best;
      const fired = firedProbeKeys(source.text);
      const fields = inferDesignFields(source.text, fired);
      const credibility = scoreDesignCredibility(fields);
      const gatesParse = parseEligibility(source.text);

      // Confidence IS the deterministic prior weight for this trial's design strength.
      const confidence = clamp01(credibility.priorWeight);

      const groundedSpans = groundDesignSignals(source);

      const detail: Record<string, unknown> = {
        sourceId: source.id,
        trialHits: best.hits,
        tier: credibility.tier,
        tierLabel: credibility.tierLabel,
        priorWeight: credibility.priorWeight,
        points: credibility.points,
        factors: credibility.factors,
        gates: {
          inclusionCount: gatesParse.inclusion.length,
          exclusionCount: gatesParse.exclusion.length,
        },
        inferredFields: {
          randomized: fields.randomized ?? null,
          blinding: fields.blinding ?? null,
          enrollment: fields.enrollment ?? null,
          phase: fields.phase ?? null,
        },
      };

      return makeContribution(EXPERT_ID, {
        ran: true,
        // Design credibility WEIGHTS a source; it never asserts support/refute.
        signal: "neutral",
        confidence,
        summary: summarize(
          credibility,
          gatesParse.inclusion.length,
          gatesParse.exclusion.length
        ),
        detail,
        groundedSpans,
        usedClaude: false,
      });
    } catch (err: unknown) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
