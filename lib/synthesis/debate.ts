// NATIVE PORT of STORM's multi-perspective debate SHAPE, specialized for PaperTrail's
// MIXED-verdict case (backend/engines/storm). Upstream STORM runs an LLM-driven
// conversation between a writer and simulated experts to research a topic; PaperTrail
// borrows the SHAPE — a structured, multi-perspective debate — but strips the black box.
//
// When a claim has BOTH supporting and refuting evidence (a mixed verdict), a flat
// "trust score" hides the disagreement. buildDebate instead assembles a four-part debate
// skeleton — Claim / Best-Case-For / Critique / Synthesis — DETERMINISTICALLY from the
// evidence the caller provides. It ORGANIZES; it does not invent.
//
// MOAT RULES enforced here (mirrors backend/engines/storm/papertrail_debate.py):
//   * NO LLM in any numeric/scoring/ranking/stance path. Evidence strength is a fixed
//     pattern heuristic (scoreSnippet); ranking is deterministic (score desc, id asc,
//     order asc); the synthesis STANCE is computed from counts alone (computeStance).
//     The same input always yields the same debate. Claude may ONLY write the connective
//     PROSE between sections — never a stance, a rank, a count, or a quote.
//   * Every evidence quote is GROUNDED against the real source text via
//     lib/grounding.locateSpan and the VERBATIM located substring is what we emit.
//     Ungroundable quotes are DROPPED and counted (droppedUngrounded) — no unsourced
//     claim about a source, ever. (The Python module trusts pre-vetted snippet inputs;
//     this TS mirror adds the grounding invariant on top of the same ordering math.)
//   * Honest insufficiency over a forced answer: an empty side yields a "one_sided" /
//     "insufficient" stance rather than pretending a debate exists.
//
// Claude is INJECTABLE (deps.callClaude) so the whole flow runs offline in tests with no
// live API. This file performs no direct DB/network I/O and never mutates its inputs.

import { z } from "zod";
import { locateSpan, type SpanGroundingStatus } from "../grounding";

// ---------------------------------------------------------------------------
// Boundary schemas. Everything crossing into this module (route body, model output) is
// validated the moment it arrives — never a raw JSON.parse trusted downstream.
// ---------------------------------------------------------------------------

// One pre-retrieved evidence snippet: an id and its (cached source) text. The text is
// both the candidate quote AND what we ground against, so a mixed-verdict debate quote is
// always a verbatim substring of a real source.
export const DebateSnippetSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type DebateSnippet = z.infer<typeof DebateSnippetSchema>;

// Boundary input for buildDebate / the route.
export const BuildDebateInputSchema = z.object({
  claim: z.string().trim().min(3).max(2000),
  supporting: z.array(DebateSnippetSchema).max(50).default([]),
  refuting: z.array(DebateSnippetSchema).max(50).default([]),
});
export type BuildDebateInput = z.infer<typeof BuildDebateInputSchema>;

// ---------------------------------------------------------------------------
// Ranking constants — MUST stay identical to papertrail_debate.py so the Python
// assembler and this mirror order the same evidence the same way.
// ---------------------------------------------------------------------------
const MAX_QUOTES_PER_SIDE = 5;
const STANCE_MARGIN_THRESHOLD = 2;

// Fixed evidence-strength patterns. Snippets carrying the hallmarks of a concrete
// quantitative finding (p-values, CIs, effect sizes, sample size) outrank vague prose.
// Keyword/pattern signals only — NO model, NO learning. Mirrors _STAT_PATTERNS.
const STAT_PATTERNS: ReadonlyArray<{ pattern: RegExp; weight: number }> = [
  { pattern: /p\s*[<=>]\s*0?\.\d+/i, weight: 3.0 }, // p-value
  { pattern: /\b95%\s*ci\b/i, weight: 2.5 }, // confidence interval
  { pattern: /\bconfidence interval\b/i, weight: 2.5 },
  { pattern: /\bhazard ratio\b|\bhr\b/i, weight: 2.0 },
  { pattern: /\bodds ratio\b|\bor\b/i, weight: 2.0 },
  { pattern: /\brelative risk\b|\brr\b/i, weight: 2.0 },
  { pattern: /\bn\s*=\s*\d+/i, weight: 1.5 }, // sample size
  { pattern: /\d+(\.\d+)?\s*%/, weight: 1.0 }, // any percentage
  { pattern: /\bsignificant\b/i, weight: 0.75 },
];

/**
 * Deterministic evidence-strength score for one snippet. Higher = stronger, more
 * quantitative. Fixed base weight from length (capped) plus fixed statistical bonuses.
 * Reproducible; no LLM. Mirrors scoreSnippet in papertrail_debate.py (rounded to 6dp).
 */
export function scoreSnippet(text: string): number {
  let score = 0;
  for (const { pattern, weight } of STAT_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
    }
  }
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  score += Math.min(wordCount, 40) / 40;
  return Math.round(score * 1e6) / 1e6;
}

/**
 * Deterministic synthesis stance from the counts alone — NO LLM, NO invention. Mirrors
 * computeStance. one side empty ⇒ one_sided; both empty ⇒ insufficient; a margin at/above
 * the threshold ⇒ leans_supported/leans_refuted; otherwise balanced_mixed.
 */
export type DebateStance =
  | "insufficient"
  | "one_sided"
  | "leans_supported"
  | "leans_refuted"
  | "balanced_mixed";

export function computeStance(supportingCount: number, refutingCount: number): DebateStance {
  if (supportingCount === 0 && refutingCount === 0) return "insufficient";
  if (supportingCount === 0 || refutingCount === 0) return "one_sided";
  const margin = supportingCount - refutingCount;
  if (margin >= STANCE_MARGIN_THRESHOLD) return "leans_supported";
  if (-margin >= STANCE_MARGIN_THRESHOLD) return "leans_refuted";
  return "balanced_mixed";
}

// ---------------------------------------------------------------------------
// Grounding + ranking. Each snippet is grounded against the corpus of provided source
// texts: we prefer the snippet's OWN source (id-matched) first, then any other provided
// source, so a real quote still grounds even if mis-attributed. Ungroundable snippets are
// DROPPED and counted — PaperTrail's core trust invariant.
// ---------------------------------------------------------------------------

// A grounded, ranked evidence quote in the debate. `text` is the VERBATIM located
// substring of a real source (never the model's or caller's paraphrase).
export interface DebateQuote {
  id: string;
  /** The source id the quote was actually located in (may differ from `id` if mis-attributed). */
  sourceId: string;
  text: string;
  rank: number;
  score: number;
  grounding: { status: SpanGroundingStatus; start: number; end: number };
}

interface ScoredSnippet {
  id: string;
  sourceId: string;
  text: string; // verbatim located text
  order: number;
  score: number;
  grounding: { status: SpanGroundingStatus; start: number; end: number };
}

// Ground one side's snippets against the full source corpus. Drops any snippet whose text
// cannot be located in ANY provided source. Returns kept scored snippets + dropped count.
function groundSide(
  side: readonly DebateSnippet[],
  corpus: ReadonlyMap<string, string>,
  corpusOrder: readonly string[]
): { kept: ScoredSnippet[]; dropped: number } {
  const kept: ScoredSnippet[] = [];
  let dropped = 0;

  side.forEach((snippet, order) => {
    // Search the snippet's own source first, then every other provided source.
    const searchIds = [
      snippet.id,
      ...corpusOrder.filter((cid) => cid !== snippet.id),
    ];
    let located: { status: SpanGroundingStatus; start: number; end: number; text: string } | null =
      null;
    let locatedSourceId = snippet.id;
    for (const cid of searchIds) {
      const sourceText = corpus.get(cid);
      if (sourceText === undefined) continue;
      const hit = locateSpan(sourceText, snippet.text);
      if (hit) {
        located = hit;
        locatedSourceId = cid;
        break;
      }
    }

    if (!located) {
      dropped += 1;
      return;
    }

    kept.push({
      id: snippet.id,
      sourceId: locatedSourceId,
      text: located.text,
      order,
      score: scoreSnippet(located.text),
      grounding: { status: located.status, start: located.start, end: located.end },
    });
  });

  return { kept, dropped };
}

// Rank a side deterministically (score desc, id asc, original order asc), truncate, and
// shape into 1-based-ranked quotes. Returns a NEW array; inputs untouched.
function rankSide(scored: readonly ScoredSnippet[], limit: number): DebateQuote[] {
  const ordered = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return a.order - b.order;
  });
  return ordered.slice(0, limit).map((s, i) => ({
    id: s.id,
    sourceId: s.sourceId,
    text: s.text,
    rank: i + 1,
    score: s.score,
    grounding: s.grounding,
  }));
}

// ---------------------------------------------------------------------------
// Optional connective prose. Claude may write ONLY the narrative bridge for a section —
// it never sees or sets a stance, count, rank, or quote. Any prose it returns is advisory
// framing; the debate is fully valid without it. We validate its output at the boundary.
// ---------------------------------------------------------------------------
const DebateProseSchema = z.object({
  best_case_intro: z.string().trim().max(600).default(""),
  critique_intro: z.string().trim().max(600).default(""),
  synthesis_note: z.string().trim().max(600).default(""),
});
type DebateProse = z.infer<typeof DebateProseSchema>;

export type DebateClaudeCaller = <T>(args: {
  system: string;
  user: string;
  schema: { parse: (v: unknown) => T };
  maxTokens?: number;
}) => Promise<T>;

export interface BuildDebateDeps {
  callClaude?: DebateClaudeCaller;
}

const PROSE_SYSTEM =
  "You are a debate editor for PaperTrail. You are given a contested CLAIM and the number " +
  "of supporting vs refuting evidence quotes that have ALREADY been selected and ranked " +
  "for you. Write ONLY short, neutral connective prose introducing each side and a closing " +
  "synthesis note. You must NOT invent evidence, cite numbers not given to you, take a " +
  "verdict, or restate the quotes — that is decided elsewhere. Keep each field to 1-2 " +
  "sentences. Return ONLY JSON of shape {best_case_intro, critique_intro, synthesis_note}.";

function buildProseContext(
  claim: string,
  supportingCount: number,
  refutingCount: number,
  stance: DebateStance
): string {
  return [
    `CLAIM:\n${claim}`,
    "",
    `SUPPORTING QUOTES SELECTED: ${supportingCount}`,
    `REFUTING QUOTES SELECTED: ${refutingCount}`,
    `COMPUTED STANCE (do not change): ${stance}`,
    "",
    "Write neutral connective prose only. Do not add numbers or a verdict.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The assembled debate buildDebate returns.
// ---------------------------------------------------------------------------
export interface DebateSection<K extends string> {
  kind: K;
}

export interface DebateResult {
  claim: string;
  sections: {
    claim: DebateSection<"claim"> & { text: string };
    bestCaseFor: DebateSection<"best_case_for"> & { intro: string; quotes: DebateQuote[] };
    critique: DebateSection<"critique"> & { intro: string; quotes: DebateQuote[] };
    synthesis: DebateSection<"synthesis"> & {
      stance: DebateStance;
      supportingCount: number;
      refutingCount: number;
      margin: number;
      note: string;
    };
  };
  supportingCount: number;
  refutingCount: number;
  // Auditability: quotes dropped because they could not be grounded in any provided source.
  droppedUngrounded: number;
}

// Lazily pull the real Claude caller only when prose is actually requested, so pure
// grounding/ranking tests never import the SDK.
const defaultClaudeCaller: DebateClaudeCaller = async (args) => {
  const { callClaudeForJson } = await import("../claude");
  return callClaudeForJson(args);
};

/**
 * Assemble a structured, multi-perspective DEBATE for a mixed-verdict claim — a native
 * PaperTrail specialization of STORM.
 *
 * Given a claim plus supporting and refuting evidence snippets, this GROUNDS every quote
 * against the provided source text (dropping and counting the ungroundable), ranks each
 * side by a deterministic evidence-strength heuristic, and computes a synthesis STANCE
 * from the counts alone. NO number, rank, quote, or stance is LLM-decided. If
 * `deps.callClaude` is provided, Claude writes ONLY the neutral connective prose between
 * sections; the debate is fully valid (and deterministic) without it.
 *
 * Returns a NEW object; inputs are never mutated. Pure orchestration — no direct I/O here.
 */
export async function buildDebate(
  rawInput: BuildDebateInput,
  deps?: BuildDebateDeps
): Promise<DebateResult> {
  const input = BuildDebateInputSchema.parse(rawInput);

  // The grounding corpus is every provided snippet's text, keyed by id. Later duplicates
  // of an id do not clobber the first — a stable, deterministic corpus.
  const corpus = new Map<string, string>();
  const corpusOrder: string[] = [];
  for (const snip of [...input.supporting, ...input.refuting]) {
    if (!corpus.has(snip.id)) {
      corpus.set(snip.id, snip.text);
      corpusOrder.push(snip.id);
    }
  }

  const groundedSupport = groundSide(input.supporting, corpus, corpusOrder);
  const groundedRefute = groundSide(input.refuting, corpus, corpusOrder);

  const bestCaseQuotes = rankSide(groundedSupport.kept, MAX_QUOTES_PER_SIDE);
  const critiqueQuotes = rankSide(groundedRefute.kept, MAX_QUOTES_PER_SIDE);

  // Stance is computed from GROUNDED counts — evidence we couldn't source doesn't vote.
  const supportingCount = groundedSupport.kept.length;
  const refutingCount = groundedRefute.kept.length;
  const stance = computeStance(supportingCount, refutingCount);
  const margin = supportingCount - refutingCount;
  const droppedUngrounded = groundedSupport.dropped + groundedRefute.dropped;

  // Optional connective prose. Failure here NEVER breaks the debate — the numeric skeleton
  // stands on its own; prose is advisory framing only.
  let prose: DebateProse = { best_case_intro: "", critique_intro: "", synthesis_note: "" };
  if (deps?.callClaude) {
    try {
      const raw = await deps.callClaude({
        system: PROSE_SYSTEM,
        user: buildProseContext(input.claim, supportingCount, refutingCount, stance),
        schema: DebateProseSchema,
        maxTokens: 512,
      });
      prose = DebateProseSchema.parse(raw);
    } catch {
      prose = { best_case_intro: "", critique_intro: "", synthesis_note: "" };
    }
  }

  return {
    claim: input.claim,
    sections: {
      claim: { kind: "claim", text: input.claim },
      bestCaseFor: {
        kind: "best_case_for",
        intro: prose.best_case_intro,
        quotes: bestCaseQuotes,
      },
      critique: {
        kind: "critique",
        intro: prose.critique_intro,
        quotes: critiqueQuotes,
      },
      synthesis: {
        kind: "synthesis",
        stance,
        supportingCount,
        refutingCount,
        margin,
        note: prose.synthesis_note,
      },
    },
    supportingCount,
    refutingCount,
    droppedUngrounded,
  } satisfies DebateResult;
}

// Exposed for the default (production) path so the route can request prose without
// wiring the SDK itself.
export const defaultDebateDeps: BuildDebateDeps = { callClaude: defaultClaudeCaller };
