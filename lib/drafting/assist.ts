// DRAFT ASSISTANT — "the AI research assistant that proves it." Claude drafts a
// manuscript/grant section, and the deterministic engine self-corrects it: EVERY
// efficacy sentence's stated magnitude is reconciled against the engine's pooled
// number, and every supporting quote is grounded to an exact source span. Overstated
// sentences are auto-corrected to the engine's value and flagged.
//
// The division of labor (docs/BUILD_MINDSET.md):
//   - Claude does the HARD, high-volume work: reading the verified evidence, writing
//     fluent scientific prose, structuring a section, phrasing caveats. (Heavy Claude.)
//   - The ENGINE is the trust layer: runEvidencePipeline produces the VERIFIED pooled
//     number (meta-analysis → GRADE → verdict, no LLM in the numeric loop); lib/effectSize
//     re-parses each sentence's stated magnitude; lib/grounding locates each supporting
//     quote in a cached source. Numbers come from the engine, NEVER from Claude — any
//     stated magnitude that overstates the pool is overwritten with the engine's value.
//
// Honesty rule (CLAUDE.md): when the evidence report is insufficient (< 2 poolable
// trials), we DON'T force a confident draft — Claude writes a hedged section and no
// numeric claim is blessed. A quote that can't be grounded is simply dropped from its
// sentence, never presented as sourced.
//
// This file performs the ONE model call (via callClaudeForJson, Zod-validated) and
// pure verification on top of the injected pipeline result. Retrieval/DB I/O lives
// behind runEvidencePipeline; the pipeline is injectable so tests run with fixtures.

import type { Pool } from "pg";
import { callClaudeForJson, CLAUDE_MODEL } from "../claude";
import { runEvidencePipeline, type EvidencePipelineResult } from "../evidencePipeline";
import { locateSpan } from "../grounding";
import { claimedReductionPercent } from "../effectSize";
import {
  DraftAssistInputSchema,
  DraftDraftSchema,
  type DraftAssistInput,
  type DraftAssistResult,
  type DraftSectionType,
  type DraftSentenceDraft,
  type GroundedQuote,
  type VerifiedSentence,
} from "./schemas";

// A source as we need it for grounding: id + title + type + the cached raw_text the
// quote must be located in. runEvidencePipeline's UsedSource omits raw_text, so the
// caller supplies the retrieved candidates (which carry raw_text) alongside.
export interface DraftGroundingSource {
  id: string;
  title: string | null;
  source_type: string;
  raw_text: string;
}

// A run of the full pipeline PLUS the raw_text-bearing sources used, so quotes can be
// grounded. Injectable so tests drive the whole thing with fixtures and no live
// embeddings / DB / model.
export interface DraftPipeline {
  result: EvidencePipelineResult;
  sources: DraftGroundingSource[];
}

export type DraftPipelineRunner = (
  pool: Pool,
  topic: string
) => Promise<DraftPipeline>;

// Overstatement materiality: a sentence's stated reduction must exceed the engine's
// pooled reduction by this factor before we auto-correct it — keeps us off borderline
// rounding disputes, matching lib/effectSize's OVERSTATE_FACTOR.
const OVERSTATE_FACTOR = 1.5;

const DEFAULT_SECTION: DraftSectionType = "results";

// ---------------------------------------------------------------------------
// The engine's ground-truth, extracted from a pipeline result. This is the ONLY
// numeric input the drafting flow trusts. `pooledReductionPercent` is what every
// efficacy sentence is reconciled against.
// ---------------------------------------------------------------------------
interface EngineTruth {
  sufficient: boolean;
  pooledReductionPercent: number | null;
  measure: string | null;
  certainty: string | null;
  verdict: string | null;
  rationale: string;
}

function extractEngineTruth(result: EvidencePipelineResult): EngineTruth {
  const report = result.report;
  if (!report.ok) {
    return {
      sufficient: false,
      pooledReductionPercent: null,
      measure: null,
      certainty: null,
      verdict: null,
      rationale: report.reason,
    };
  }
  return {
    sufficient: true,
    pooledReductionPercent: round(report.pooled.random.reductionPercent),
    measure: report.pooled.measure,
    certainty: report.certainty.certainty,
    verdict: report.verdict.verdict,
    rationale: report.rationale,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// The Claude call (heavy work). We hand Claude the VERIFIED evidence — the pooled
// number, certainty, and the exact source quotes available — and ask for a drafted
// section as a list of sentences, each self-labeling whether it makes an efficacy
// claim and (if so) with an explicit stated magnitude + a verbatim supporting quote.
// The stated magnitude and quote are UNTRUSTED and verified downstream.
// ---------------------------------------------------------------------------
const DRAFT_SYSTEM = [
  "You are a scientific writing assistant drafting a section of a manuscript or grant",
  "for a translational-research audience. You write precise, citation-grounded prose.",
  "",
  "You are given a VERIFIED evidence summary produced by a deterministic biostatistics",
  "engine (pooled meta-analysis + GRADE). You must NOT invent numbers: any efficacy",
  "magnitude you state MUST come from the provided pooled estimate. If the evidence is",
  "insufficient, write a hedged section that does NOT assert a specific effect size.",
  "",
  "Return ONLY a JSON object of this exact shape (no prose, no markdown):",
  "{",
  '  "sentences": [',
  "    {",
  '      "text": "<one sentence of the section>",',
  '      "makesEfficacyClaim": <true|false>,',
  '      "statedReductionPercent": <number or null - the relative % reduction this',
  "         sentence asserts, if any; null otherwise>,",
  '      "supportingQuote": "<a VERBATIM quote copied EXACTLY from one of the provided',
  "         source excerpts that supports this sentence, or null>",
  "    }",
  "  ]",
  "}",
  "",
  "Rules: 4-10 sentences. Quote source text character-for-character (do not paraphrase",
  "inside supportingQuote). Only set makesEfficacyClaim=true when the sentence asserts a",
  "quantified benefit. Prefer the pooled estimate's magnitude over any single trial's.",
].join("\n");

function buildUserPrompt(
  topic: string,
  section: DraftSectionType,
  truth: EngineTruth,
  sources: DraftGroundingSource[]
): string {
  const evidenceBlock = truth.sufficient
    ? [
        `POOLED EVIDENCE (verified by the engine — use THIS magnitude, not any single trial):`,
        `- Measure: ${truth.measure}`,
        `- Pooled relative reduction: ${truth.pooledReductionPercent}%`,
        `- GRADE certainty: ${truth.certainty}`,
        `- Claim-vs-pool verdict: ${truth.verdict}`,
        `- Rationale: ${truth.rationale}`,
      ].join("\n")
    : [
        `POOLED EVIDENCE: INSUFFICIENT — the engine could not pool a confident effect.`,
        `Reason: ${truth.rationale}`,
        `Write a hedged section that does NOT assert a specific effect size.`,
      ].join("\n");

  // Provide source excerpts so Claude can copy verbatim quotes; cap length per source
  // to keep tokens bounded. Grounding still verifies against the FULL raw_text.
  const sourceBlock = sources
    .slice(0, 8)
    .map((s, i) => {
      const excerpt = s.raw_text.slice(0, 1200);
      return `[S${i + 1}] ${s.title ?? s.source_type} (${s.source_type})\n${excerpt}`;
    })
    .join("\n\n");

  return [
    `SECTION TO DRAFT: ${section}`,
    `TOPIC / CLAIM: ${topic}`,
    "",
    evidenceBlock,
    "",
    "SOURCE EXCERPTS (quote verbatim from these):",
    sourceBlock || "(no source excerpts available)",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Grounding a supporting quote: locate Claude's verbatim quote in ANY used source's
// raw_text (lib/grounding.locateSpan). Returns the FIRST source it's found in with
// verbatim text + offsets, or null if it can't be located anywhere (then it's dropped
// — PaperTrail never presents an unsourced quote as sourced).
// ---------------------------------------------------------------------------
function groundQuote(
  quote: string | null | undefined,
  sources: readonly DraftGroundingSource[]
): GroundedQuote | null {
  if (!quote || quote.trim().length === 0) return null;
  for (const source of sources) {
    const located = locateSpan(source.raw_text, quote);
    if (located) {
      return {
        source_id: source.id,
        source_title: source.title,
        source_type: source.source_type,
        quote: located.text,
        start: located.start,
        end: located.end,
        status: located.status,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-correction of ONE sentence. This is the trust layer applied per sentence:
//   1. Re-derive the sentence's own stated reduction from its TEXT (never trusting
//      Claude's self-reported number blindly): lib/effectSize.claimedReductionPercent.
//      Fall back to Claude's stated number only to catch claims the regex misses.
//   2. Ground the supporting quote to an exact source span (drop if ungroundable).
//   3. Reconcile the stated magnitude against the ENGINE's pooled reduction. If the
//      sentence materially overstates the pool, REWRITE it to the engine's value and
//      flag it. Numbers come from the engine.
// A sentence is `grounded` when it is either non-numeric with a located quote, OR its
// numeric magnitude is consistent-or-corrected AND (for numeric claims) a quote is
// located. An overstated-and-corrected sentence is grounded (we fixed it to truth).
// ---------------------------------------------------------------------------
function verifySentence(
  draft: DraftSentenceDraft,
  truth: EngineTruth,
  sources: readonly DraftGroundingSource[]
): VerifiedSentence {
  const groundedQuote = groundQuote(draft.supportingQuote, sources);

  // Re-parse the magnitude from the sentence text (authoritative), falling back to
  // Claude's self-reported value which we treat as untrusted metadata.
  const parsedFromText = claimedReductionPercent(draft.text);
  const stated =
    parsedFromText ??
    (typeof draft.statedReductionPercent === "number" ? draft.statedReductionPercent : null);

  const makesEfficacyClaim = draft.makesEfficacyClaim || stated !== null;
  const engineReduction = truth.pooledReductionPercent;

  const base: VerifiedSentence = {
    text: draft.text,
    makesEfficacyClaim,
    grounded: false,
    engineReductionPercent: engineReduction,
    ...(groundedQuote ? { quote: groundedQuote } : {}),
  };

  // Non-numeric sentence: grounded iff a supporting quote was located, OR it makes no
  // factual efficacy assertion needing a source (narrative/framing). We ground it when
  // a quote is located; otherwise it stands as prose but is marked ungrounded so the
  // UI shows it isn't backed by a located span.
  if (!makesEfficacyClaim) {
    return { ...base, grounded: groundedQuote !== null };
  }

  // Numeric sentence but the engine has no pooled number (insufficient evidence): any
  // asserted magnitude is unverifiable — DROP the number by correcting to a hedge.
  if (engineReduction === null || !truth.sufficient) {
    if (stated === null) {
      // No explicit number to correct; treat as grounded only if quote located.
      return { ...base, grounded: groundedQuote !== null };
    }
    return {
      ...base,
      text: hedgeSentence(draft.text),
      grounded: groundedQuote !== null,
      corrected: {
        original: draft.text,
        statedReductionPercent: round(stated),
        engineReductionPercent: engineReduction ?? 0,
        reason:
          "The engine could not pool a confident effect size for this topic, so the stated magnitude is unverifiable and was removed. A specific efficacy figure must not be asserted from insufficient evidence.",
      },
    };
  }

  // Numeric sentence with an engine number to check against.
  if (stated === null) {
    // Efficacy-flagged but no parseable magnitude: grounded iff quote located.
    return { ...base, grounded: groundedQuote !== null };
  }

  const overstated = engineReduction > 0 && stated > engineReduction * OVERSTATE_FACTOR;
  if (overstated) {
    const correctedText = rewriteMagnitude(draft.text, stated, engineReduction);
    return {
      ...base,
      text: correctedText,
      // Corrected to the engine's ground truth: it is now grounded in the pooled number.
      grounded: true,
      corrected: {
        original: draft.text,
        statedReductionPercent: round(stated),
        engineReductionPercent: engineReduction,
        reason: `The draft stated a ~${round(stated)}% reduction, but the engine's pooled estimate is ~${round(engineReduction)}%. The magnitude was overstated and corrected to the engine's verified value.`,
      },
    };
  }

  // Consistent with the pool: grounded. A quote strengthens it but isn't required when
  // the number itself already reconciles with the engine's verified pooled estimate.
  return { ...base, grounded: true };
}

// Rewrite a stated percentage in the sentence text to the engine's value. Deterministic
// string substitution of the first "<num>%" token; if none is found (e.g. the magnitude
// was implied via a ratio), append an explicit engine-value clause. Pure.
function rewriteMagnitude(text: string, _stated: number, engine: number): string {
  const engineStr = `${round(engine)}%`;
  const pctRe = /\d+(?:\.\d+)?\s*%/;
  if (pctRe.test(text)) {
    return text.replace(pctRe, engineStr);
  }
  return `${text.replace(/\.\s*$/, "")} (engine-verified pooled reduction: ${engineStr}).`;
}

// Replace a specific-magnitude assertion with a hedge when evidence is insufficient.
function hedgeSentence(text: string): string {
  const pctRe = /\d+(?:\.\d+)?\s*%/;
  if (pctRe.test(text)) {
    return text.replace(pctRe, "an effect that the available evidence could not confidently quantify");
  }
  return `${text.replace(/\.\s*$/, "")}, though the available evidence was insufficient to confidently quantify the effect.`;
}

// ---------------------------------------------------------------------------
// Orchestrator. Runs the pipeline, calls Claude once for the draft, then verifies
// every sentence against the engine. Injectable pipeline + model call for tests.
// ---------------------------------------------------------------------------
export async function runDraftAssist(
  pool: Pool,
  input: DraftAssistInput,
  opts?: {
    runPipeline?: DraftPipelineRunner;
    draft?: (system: string, user: string) => Promise<{ sentences: DraftSentenceDraft[] }>;
  }
): Promise<DraftAssistResult> {
  const parsed = DraftAssistInputSchema.parse(input);
  const section = parsed.section ?? DEFAULT_SECTION;

  // 1. VERIFIED evidence via the deterministic pipeline (no LLM in the numeric loop).
  const runPipeline: DraftPipelineRunner =
    opts?.runPipeline ?? defaultPipelineRunner;
  const pipeline = await runPipeline(pool, parsed.topic);
  const truth = extractEngineTruth(pipeline.result);

  // 2. HEAVY CLAUDE: draft the section grounded in that verified evidence. Validated
  //    against DraftDraftSchema — raw JSON is never trusted.
  const drafter =
    opts?.draft ??
    ((system, user) =>
      callClaudeForJson({ system, user, schema: DraftDraftSchema, maxTokens: 2048 }));

  const rawDraft = await drafter(
    DRAFT_SYSTEM,
    buildUserPrompt(parsed.topic, section, truth, pipeline.sources)
  );
  const draft = DraftDraftSchema.parse(rawDraft);

  // 3. SELF-CORRECTION: verify every sentence against the engine + ground its quotes.
  const sentences = draft.sentences.map((s) => verifySentence(s, truth, pipeline.sources));

  const efficacyClaims = sentences.filter((s) => s.makesEfficacyClaim).length;
  const grounded = sentences.filter((s) => s.grounded).length;
  const corrected = sentences.filter((s) => s.corrected).length;

  return {
    topic: parsed.topic,
    section,
    sentences,
    sources: pipeline.result.usedSources.map((s) => ({
      id: s.id,
      title: s.title,
      source_type: s.source_type,
    })),
    evidence: {
      sufficient: truth.sufficient,
      pooledReductionPercent: truth.pooledReductionPercent,
      measure: truth.measure,
      certainty: truth.certainty,
      verdict: truth.verdict,
      rationale: truth.rationale,
    },
    summary: {
      totalSentences: sentences.length,
      efficacyClaims,
      grounded,
      corrected,
    },
  };
}

// Default pipeline runner: run the real evidence pipeline, and re-run the injectable
// retriever ONCE to capture the raw_text-bearing sources for grounding. The pipeline's
// UsedSource intentionally omits raw_text, so we retrieve the candidates alongside and
// keep only the ones the pipeline actually used (by id), preserving the citation trail.
async function defaultPipelineRunner(pool: Pool, topic: string): Promise<DraftPipeline> {
  const { retrieveSources } = await import("../agents/retrievalAgent");
  const candidates = await retrieveSources(topic);
  const result = await runEvidencePipeline(pool, { claim: topic }, {
    retrieve: async () => candidates,
  });
  const usedIds = new Set(result.usedSources.map((s) => s.id));
  const sources: DraftGroundingSource[] = candidates
    .filter((c) => usedIds.has(c.id))
    .map((c) => ({
      id: c.id,
      title: c.title ?? null,
      source_type: c.source_type,
      raw_text: c.raw_text ?? "",
    }));
  return { result, sources };
}

// Re-exported for the route so it can name the model in metadata without importing claude.
export { CLAUDE_MODEL };
