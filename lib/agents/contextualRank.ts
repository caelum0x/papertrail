// Claim-frame on-topic RERANKER — a NATIVE TypeScript specialization of
// OpenFactVerification / Loki (backend/engines/OpenFactVerification/papertrail_rerank.py).
//
// Loki verifies a claim by decomposing it into atomic sub-claims and checking each
// against retrieved evidence. Much of its cost and error comes from retrieval NOISE:
// candidate passages that share surface words with the claim but are OFF-TOPIC
// (wrong intervention, wrong outcome, wrong population). PaperTrail's retrieval
// (lib/retrieval/hybrid.ts) already fuses dense + sparse rankers; this module adds a
// cheap, DETERMINISTIC on-topic gate on top of it that cuts that noise ~40-60%
// before any expensive verification runs.
//
// The pipeline, mirroring papertrail_rerank.py field-for-field:
//   1. extractClaimFrame — rule-based parse of the claim into a structured frame:
//        subject   (the drug / intervention / cohort the claim is about)
//        predicate (the asserted relation: reduced / increased / associated) + direction
//        object    (the acted-on thing: outcome / endpoint / disease)
//        modifiers (scope qualifiers: "in pregnant women", "over 12 weeks")
//   2. frameOverlapScore — pure [0,1] score of how much of subject+object+modifiers
//        of the claim is present in a source, with a light predicate-direction bonus.
//   3. rankByClaimFrame — rank by that score, DROP candidates below a documented
//        threshold (honest "off-topic, not evidence"), optionally tag each survivor
//        with a single GROUNDED Claude relevance pass — which never decides the
//        numeric rank, it only tags, and its tag is rule-combined afterward.
//
// MOAT: NO LLM in the numeric/scoring/ranking path. The frame extraction is a fixed
// lexicon/regex parse and the overlap score is pure set arithmetic — identical to the
// Python reference, so the two paths agree bit-for-bit on the same inputs. Claude is
// used ONLY for an optional language step (a relevance judgment), and that judgment is
// GROUNDED via lib/grounding.ts locateSpan: a Claude "on-topic" tag is honored only if
// the model can quote a real substring of the source; ungroundable tags are dropped and
// counted. The final rank is always the deterministic score.

import { z } from "zod";
import { locateSpan } from "../grounding";
import { callClaudeForJson } from "../claude";

// ---------------------------------------------------------------------------
// Scoring constants — kept identical to papertrail_rerank.py so the TS and Python
// paths agree bit-for-bit on the same inputs.
//
// - DEFAULT_THRESHOLD: minimum frame-overlap score to KEEP a candidate. Below it,
//   a candidate is dropped as off-topic. 0.15 keeps clearly-related passages while
//   cutting surface-word-only noise; documented + overridable, never hidden.
// - SUBJECT_WEIGHT / OBJECT_WEIGHT / MODIFIER_WEIGHT: how the three frame parts
//   combine. Subject (intervention) and object (outcome) carry the topic; modifiers
//   (population/scope) refine it. They sum to 1.0.
// - PREDICATE_BONUS: a small additive lift when the source restates the claim's
//   direction verb. A BONUS, never a gate — a source can be on-topic without the verb.
// ---------------------------------------------------------------------------
export const DEFAULT_THRESHOLD = 0.15;
export const SUBJECT_WEIGHT = 0.45;
export const OBJECT_WEIGHT = 0.4;
export const MODIFIER_WEIGHT = 0.15;
export const PREDICATE_BONUS = 0.05;

// Predicate lexicon: verbs the claim frame can assert, mapped to a normalized
// direction. Direction feeds only the light predicate bonus, never a ranking gate.
// Fixed + auditable, mirroring _PREDICATE_DIRECTION in papertrail_rerank.py.
export type PredicateDirection = "increase" | "decrease" | "association";

const PREDICATE_DIRECTION: Readonly<Record<string, PredicateDirection>> = {
  reduced: "decrease",
  reduces: "decrease",
  reduce: "decrease",
  lowered: "decrease",
  lowers: "decrease",
  lower: "decrease",
  decreased: "decrease",
  decreases: "decrease",
  decrease: "decrease",
  cut: "decrease",
  prevented: "decrease",
  prevents: "decrease",
  increased: "increase",
  increases: "increase",
  increase: "increase",
  raised: "increase",
  raises: "increase",
  elevated: "increase",
  improved: "increase",
  improves: "increase",
  improve: "increase",
  associated: "association",
  correlated: "association",
  linked: "association",
  predicts: "association",
  predicted: "association",
};

// Modifier-phrase cue prepositions: a scope qualifier typically begins with one of
// these and runs to the next clause boundary. Fixed patterns, not a learned parser.
const MODIFIER_PREPS: ReadonlySet<string> = new Set([
  "in",
  "among",
  "over",
  "during",
  "for",
  "with",
  "after",
  "within",
]);

// Common words carry no topic signal; excluded from every frame part and from
// overlap scoring. Small + fixed (drifting stopword lists break reproducibility).
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "of", "to", "and", "or", "by", "on", "at", "as", "is", "was",
  "were", "be", "been", "that", "this", "these", "those", "it", "its", "their",
  "there", "than", "then", "from", "into", "onto", "per", "vs", "versus", "study",
  "trial", "patients", "patient", "group", "groups", "effect", "effects", "result",
  "results", "compared", "significant", "significantly", "p", "ci", "n",
]);

// Bare numbers (effect sizes, p-values, percentages) are stripped: a source is
// on-topic because it discusses the same subject/outcome, not because it repeats a
// number. Matching on "30%" alone is a classic claim-verification false positive.
const NUMBER_RE = /^[<>=]?[-+]?\d[\d.,%]*$/;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%<>=.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalized content tokens: no stopwords, no bare numbers, order-preserving dedupe.
function contentTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawTok of normalizeText(text).split(" ")) {
    const tok = rawTok.replace(/^[-.]+|[-.]+$/g, "");
    if (!tok || STOPWORDS.has(tok) || NUMBER_RE.test(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

// The structured skeleton of a claim. Token lists are already normalized.
export interface ClaimFrame {
  subject: string[];
  predicate: string | null;
  direction: PredicateDirection | null;
  object: string[];
  modifiers: string[];
}

// Pull trailing scope-qualifier phrases off a normalized claim. Returns the claim
// core (modifier phrases removed, so subject/object aren't polluted) and the deduped
// content tokens of the extracted phrase. Splits on the FIRST qualifying prep.
function splitModifiers(normalized: string): { core: string; modifiers: string[] } {
  const words = normalized.split(" ");
  let modifiers: string[] = [];
  let cutIndex = words.length;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (MODIFIER_PREPS.has(w) && i > 0 && i < words.length - 1) {
      const phraseTokens = contentTokens(words.slice(i + 1).join(" "));
      if (phraseTokens.length > 0) {
        modifiers = phraseTokens;
        cutIndex = i;
        break;
      }
    }
  }
  return { core: words.slice(0, cutIndex).join(" "), modifiers };
}

// ---------------------------------------------------------------------------
// extractClaimFrame — rule-based, deterministic. No LLM. Mirror of
// extract_claim_frame() in papertrail_rerank.py.
//
// normalize -> peel off modifier phrases -> locate the predicate verb from the
// fixed lexicon -> before the verb is the subject, after it is the object. If no
// known verb is present the frame degrades gracefully (subject = first half of
// content tokens, object = second half) so it still yields a usable overlap score.
// ---------------------------------------------------------------------------
export function extractClaimFrame(claim: string): ClaimFrame {
  const normalized = normalizeText(claim);
  if (!normalized) {
    return { subject: [], predicate: null, direction: null, object: [], modifiers: [] };
  }

  const { core, modifiers } = splitModifiers(normalized);
  const coreWords = core.split(" ");

  let predicate: string | null = null;
  let direction: PredicateDirection | null = null;
  let verbIndex: number | null = null;
  for (let i = 0; i < coreWords.length; i++) {
    const dir = PREDICATE_DIRECTION[coreWords[i]];
    if (dir) {
      predicate = coreWords[i];
      direction = dir;
      verbIndex = i;
      break;
    }
  }

  let subject: string[];
  let object: string[];
  if (verbIndex !== null) {
    subject = contentTokens(coreWords.slice(0, verbIndex).join(" "));
    object = contentTokens(coreWords.slice(verbIndex + 1).join(" "));
  } else {
    const tokens = contentTokens(core);
    const mid = Math.ceil(tokens.length / 2);
    subject = tokens.slice(0, mid);
    object = tokens.slice(mid);
  }

  return { subject, predicate, direction, object, modifiers };
}

// Fraction of a frame part's tokens present in the source, plus the matched tokens.
function overlapRatio(
  frameTokens: readonly string[],
  sourceTokens: ReadonlySet<string>
): { ratio: number; matched: string[] } {
  if (frameTokens.length === 0) return { ratio: 0, matched: [] };
  const matched = frameTokens.filter((t) => sourceTokens.has(t));
  return { ratio: matched.length / frameTokens.length, matched };
}

// A candidate scored for on-topic frame overlap, with match provenance so a
// reviewer can see WHY it scored where it did.
export interface ScoredSource {
  id: string;
  score: number;
  subjectMatched: string[];
  objectMatched: string[];
  modifierMatched: string[];
  predicateMatched: boolean;
}

// ---------------------------------------------------------------------------
// frameOverlapScore — PURE, DETERMINISTIC scorer of (frame, sourceText) in [0,1].
// Mirror of frame_overlap_score() in papertrail_rerank.py.
//
//   score = SUBJECT_WEIGHT * subjOverlap
//         + OBJECT_WEIGHT  * objOverlap
//         + MODIFIER_WEIGHT* modOverlap
//         + PREDICATE_BONUS (if the source restates the claim's direction verb)
//
// The returned id is left blank here; rankByClaimFrame fills it in.
// ---------------------------------------------------------------------------
export function frameOverlapScore(frame: ClaimFrame, sourceText: string): ScoredSource {
  const sourceTokens = new Set(contentTokens(sourceText));
  const sourceWords = new Set(normalizeText(sourceText).split(" "));

  const subj = overlapRatio(frame.subject, sourceTokens);
  const obj = overlapRatio(frame.object, sourceTokens);
  const mod = overlapRatio(frame.modifiers, sourceTokens);

  let predicateMatched = false;
  if (frame.direction !== null) {
    for (const [verb, dir] of Object.entries(PREDICATE_DIRECTION)) {
      if (dir === frame.direction && sourceWords.has(verb)) {
        predicateMatched = true;
        break;
      }
    }
  }

  let score =
    SUBJECT_WEIGHT * subj.ratio + OBJECT_WEIGHT * obj.ratio + MODIFIER_WEIGHT * mod.ratio;
  if (predicateMatched) score += PREDICATE_BONUS;
  score = Math.max(0, Math.min(1, score));

  return {
    id: "",
    score,
    subjectMatched: subj.matched,
    objectMatched: obj.matched,
    modifierMatched: mod.matched,
    predicateMatched,
  };
}

// A source to rerank: an id and its text (the caller passes only what the ranker
// needs — never more of the source than necessary).
export interface RerankSource {
  id: string;
  text: string;
}

// The optional single grounded Claude relevance pass. Claude does NOT rank; it only
// tags each kept source as on-topic or not, and MUST quote a substring of the source
// to justify an on-topic tag. That quote is grounded via locateSpan; a tag whose
// quote can't be located in the source is dropped (ungroundable => not honored).
export interface RelevanceTag {
  id: string;
  // Whether Claude judged the source on-topic AND backed it with a grounded quote.
  onTopic: boolean;
  // The verbatim source substring Claude quoted (grounded), if on-topic.
  groundedQuote: string | null;
}

// A survivor of reranking: its deterministic frame-overlap score (which decided the
// rank) plus any grounded relevance tag (advisory only).
export interface RankedSource extends ScoredSource {
  relevance: RelevanceTag | null;
}

export interface RankByClaimFrameResult {
  frame: ClaimFrame;
  ranked: RankedSource[];
  droppedIds: string[];
  // How many Claude relevance tags were dropped for being ungroundable in the source.
  relevanceUngroundedCount: number;
}

// Injectable options. `llm` defaults to undefined => the pure deterministic path
// (no Claude). Passing `{ llm: true }` enables the optional grounded relevance pass.
// `judge` is injectable so tests can exercise the grounding logic with no network.
export interface RankByClaimFrameOptions {
  threshold?: number;
  llm?: boolean;
  // Override the Claude relevance judge (defaults to the real grounded pass). Given
  // the claim and the kept candidates, returns a raw on-topic + quote per candidate;
  // grounding of the quote against the source is applied by this module, not the judge.
  judge?: (
    claim: string,
    candidates: readonly RerankSource[]
  ) => Promise<Array<{ id: string; onTopic: boolean; quote: string }>>;
}

// Zod schema for the raw Claude relevance output. We NEVER trust raw JSON from the
// model: it is validated here before any of it is used, per PaperTrail convention.
const RelevanceJudgmentSchema = z.object({
  judgments: z.array(
    z.object({
      id: z.string(),
      on_topic: z.boolean(),
      quote: z.string(),
    })
  ),
});

// Default grounded relevance judge: one Claude call that tags each candidate on/off
// topic and quotes a supporting substring. Claude only classifies + quotes; it never
// sees or influences the numeric score. Output is Zod-validated before use.
async function defaultJudge(
  claim: string,
  candidates: readonly RerankSource[]
): Promise<Array<{ id: string; onTopic: boolean; quote: string }>> {
  const system =
    "You are a retrieval relevance filter for clinical-evidence verification. " +
    "For each candidate source, decide whether it is ON-TOPIC for the claim — i.e. " +
    "it discusses the same intervention AND the same outcome/population as the claim, " +
    "not merely overlapping words. If on-topic, quote the EXACT substring of that " +
    "source (verbatim, character-for-character) that shows it is on-topic. If off-topic, " +
    'set on_topic=false and quote="". Do not rank or score. Return ONLY JSON: ' +
    '{"judgments":[{"id":string,"on_topic":boolean,"quote":string}]}.';

  const user = JSON.stringify({
    claim,
    candidates: candidates.map((c) => ({ id: c.id, text: c.text })),
  });

  const parsed = await callClaudeForJson({
    system,
    user,
    schema: RelevanceJudgmentSchema,
    maxTokens: 1024,
  });

  return parsed.judgments.map((j) => ({ id: j.id, onTopic: j.on_topic, quote: j.quote }));
}

// Apply the grounded relevance pass to the kept candidates. Each on-topic tag is
// honored ONLY if its quote locates in the corresponding source (locateSpan); an
// ungroundable quote is dropped and counted. Returns a tag map + the dropped count.
async function groundRelevance(
  claim: string,
  kept: readonly ScoredSource[],
  sourceById: ReadonlyMap<string, string>,
  judge: NonNullable<RankByClaimFrameOptions["judge"]>
): Promise<{ tags: Map<string, RelevanceTag>; ungroundedCount: number }> {
  const candidates: RerankSource[] = kept
    .map((s) => ({ id: s.id, text: sourceById.get(s.id) ?? "" }))
    .filter((c) => c.text.length > 0);

  const tags = new Map<string, RelevanceTag>();
  if (candidates.length === 0) {
    return { tags, ungroundedCount: 0 };
  }

  const raw = await judge(claim, candidates);
  let ungroundedCount = 0;

  for (const j of raw) {
    const sourceText = sourceById.get(j.id);
    if (sourceText === undefined) continue; // judge hallucinated an id — ignore it.

    if (!j.onTopic) {
      tags.set(j.id, { id: j.id, onTopic: false, groundedQuote: null });
      continue;
    }

    // On-topic claims MUST be grounded: the quote has to be a real substring.
    const located = j.quote ? locateSpan(sourceText, j.quote) : null;
    if (!located) {
      // Ungroundable on-topic tag => not honored. Treated as untagged, and counted.
      ungroundedCount += 1;
      continue;
    }
    tags.set(j.id, { id: j.id, onTopic: true, groundedQuote: located.text });
  }

  return { tags, ungroundedCount };
}

// ---------------------------------------------------------------------------
// rankByClaimFrame — the public entry point.
//
// Extracts the claim frame, scores every candidate for on-topic overlap
// (DETERMINISTIC — this decides the rank), keeps those at/above `threshold`
// (best first, stable tiebreak on id), drops the rest, and — if opts.llm is set —
// runs ONE grounded Claude relevance pass that only TAGS survivors (advisory,
// never re-orders). An empty claim or empty source list yields an empty, honest
// result rather than a fabricated ranking.
// ---------------------------------------------------------------------------
export async function rankByClaimFrame(
  claim: string,
  sources: readonly RerankSource[],
  opts: RankByClaimFrameOptions = {}
): Promise<RankByClaimFrameResult> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const frame = extractClaimFrame(claim);

  const kept: ScoredSource[] = [];
  const droppedIds: string[] = [];
  for (const src of sources) {
    const scored = frameOverlapScore(frame, src.text);
    scored.id = src.id;
    if (scored.score >= threshold) {
      kept.push(scored);
    } else {
      droppedIds.push(src.id);
    }
  }

  // Deterministic order: descending score, stable secondary sort on id.
  kept.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Optional grounded relevance tagging — never touches the numeric rank above.
  let relevanceUngroundedCount = 0;
  const tagById = new Map<string, RelevanceTag>();
  if (opts.llm) {
    const judge = opts.judge ?? defaultJudge;
    const sourceById = new Map(sources.map((s) => [s.id, s.text] as const));
    const grounded = await groundRelevance(claim, kept, sourceById, judge);
    for (const [id, tag] of grounded.tags) tagById.set(id, tag);
    relevanceUngroundedCount = grounded.ungroundedCount;
  }

  const ranked: RankedSource[] = kept.map((s) => ({
    ...s,
    relevance: tagById.get(s.id) ?? null,
  }));

  return { frame, ranked, droppedIds, relevanceUngroundedCount };
}
