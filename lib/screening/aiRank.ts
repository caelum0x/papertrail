import { callClaudeForJson } from "@/lib/claude";
import { isAsreviewEnabled, rankRecords } from "@/lib/engines/asreview";
import {
  AiRankResponseSchema,
  type AiRankItem,
  type RankableRecord,
  type RankedRecord,
  type ScreeningVerdict,
} from "./schemas";

// AI ACTIVE-LEARNING SCREENING (ASReview-style). Given a systematic review's
// inclusion criteria and a batch of candidate records {title, abstract}, Claude
// scores each 0..1 for relevance, assigns include/exclude/uncertain, and writes a
// one-line rationale grounded in that record's own abstract. The reviewer then
// screens the most-likely-relevant records first, cutting the manual burden of
// title/abstract screening — the heavy, repetitive part of a systematic review.
//
// This is genuine high-volume Claude work: per-abstract relevance reasoning against
// bespoke criteria, over many records, where a keyword filter can't judge semantic
// relevance ("does this trial's population/intervention/outcome match the question?").
//
// TRUST LAYER (why heavy Claude use is safe here): every rationale Claude returns is
// verified against the record's abstract via deterministic token-overlap grounding.
// A rationale that talks about content NOT in the abstract is flagged groundingOk:false
// so a reviewer never trusts a fabricated justification. We keep the model's ranking
// (relevance is a judgement, not a factual claim about a source span) but surface the
// grounding signal alongside it — mirroring the project's "ground every factual claim"
// rule without discarding an honest uncertain verdict.

// How many records to send Claude in one request. Abstracts are long; batching keeps
// each request within a sane token budget while still amortising the criteria prompt
// across many records. Callers cap the total; this bounds a single model call.
const BATCH_SIZE = 25;

// Rationale grounding threshold: fraction of the rationale's content words that must
// also appear in the record's abstract for the rationale to count as grounded. A
// paraphrased one-liner won't quote verbatim, so we use content-word overlap rather
// than exact-span matching. Tuned to catch fabrication, not to demand quotation.
const GROUNDING_OVERLAP_THRESHOLD = 0.5;

// Very common words carry no grounding signal — excluding them stops a rationale from
// looking "grounded" purely because it shares "the/of/was" with the abstract.
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "was",
  "were", "is", "are", "be", "been", "this", "that", "these", "those", "it",
  "as", "at", "by", "from", "no", "not", "study", "trial", "patients", "results",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Deterministic trust check: is this one-line rationale grounded in the record's own
 * abstract? We require that at least GROUNDING_OVERLAP_THRESHOLD of the rationale's
 * content words also appear in the abstract. Title-only records (no abstract) can't be
 * grounded this way, so we ground against the title instead — a lower bar, but honest.
 * Pure function; does not mutate its inputs.
 */
export function isRationaleGrounded(
  rationale: string,
  record: Pick<RankableRecord, "title" | "abstract">
): boolean {
  const rationaleWords = contentWords(rationale);
  if (rationaleWords.length === 0) return false;

  const source = `${record.title} ${record.abstract ?? ""}`;
  const sourceWords = new Set(contentWords(source));
  if (sourceWords.size === 0) return false;

  const overlap = rationaleWords.filter((w) => sourceWords.has(w)).length;
  return overlap / rationaleWords.length >= GROUNDING_OVERLAP_THRESHOLD;
}

function buildSystemPrompt(): string {
  return [
    "You are an expert systematic-review screener performing title/abstract screening.",
    "You rank candidate records by how likely each is to MEET the reviewer's inclusion criteria,",
    "so the reviewer screens the most-likely-relevant records first (active-learning triage).",
    "",
    "For EACH record, decide relevance ONLY from its title and abstract against the criteria:",
    "- relevance: a number 0..1 — probability the record meets the inclusion criteria.",
    "- verdict: 'include' if it clearly meets the criteria, 'exclude' if it clearly does not,",
    "  'uncertain' if the abstract is too thin to decide. Prefer 'uncertain' over a confident guess.",
    "- rationale: ONE short line (max ~30 words) justifying the score, phrased ONLY in terms of",
    "  what THIS record's title/abstract actually says. Do NOT invent facts not in the abstract.",
    "",
    "Return STRICT JSON: {\"rankings\":[{\"id\":\"...\",\"relevance\":0.0,\"verdict\":\"...\",\"rationale\":\"...\"}]}",
    "One entry per input record, using the exact id given. No prose outside the JSON.",
  ].join("\n");
}

function buildUserPrompt(criteria: string[], records: RankableRecord[]): string {
  const criteriaBlock =
    criteria.length > 0
      ? criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "(No explicit inclusion criteria provided — judge general topical relevance to the review question.)";

  const recordsBlock = records
    .map((r) => {
      const abstract = r.abstract?.trim() ? r.abstract.trim() : "(no abstract provided)";
      return `--- RECORD id=${r.id} ---\nTitle: ${r.title}\nAbstract: ${abstract}`;
    })
    .join("\n\n");

  return [
    "INCLUSION CRITERIA:",
    criteriaBlock,
    "",
    `RECORDS TO RANK (${records.length}):`,
    recordsBlock,
  ].join("\n");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Rank a single batch of records with Claude, validated against the Zod array schema.
 * Only rankings whose id is one of the input records are kept (defends against the
 * model echoing a stray id); missing records simply don't appear in the result and
 * are handled by the caller. Never throws for a partial/oversized model response —
 * it filters to the valid intersection. Network/parse errors DO propagate so the
 * route can surface an honest failure rather than a silent empty ranking.
 */
async function rankBatch(
  criteria: string[],
  records: RankableRecord[]
): Promise<AiRankItem[]> {
  const validIds = new Set(records.map((r) => r.id));

  const parsed = await callClaudeForJson({
    system: buildSystemPrompt(),
    user: buildUserPrompt(criteria, records),
    schema: AiRankResponseSchema,
    // Each record needs a small JSON object; budget generously for the batch so a
    // large batch's ranking is never truncated mid-array (which would fail parsing).
    maxTokens: Math.min(4096, 200 + records.length * 120),
  });

  const seen = new Set<string>();
  const items: AiRankItem[] = [];
  for (const item of parsed.rankings) {
    if (!validIds.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export interface AiRankResult {
  ranked: RankedRecord[];
  /** Records the model returned no valid ranking for (kept out of `ranked`). */
  unrankedIds: string[];
}

/**
 * A prior human screening decision on a record, used only to TRAIN the optional
 * ASReview active learner (opt-in engine). `include`/`exclude` map to the engine's
 * 1/0 relevance labels; `uncertain` carries no training signal and is ignored.
 */
export interface PriorDecision {
  id: string;
  decision: ScreeningVerdict;
}

/**
 * Optional ASReview active-learning path (opt-in via env). Given prior include/exclude
 * decisions, the merged ASReview engine (TF-IDF + NaiveBayes, in a Python subprocess)
 * re-ranks the unlabeled records most-relevant-first. We map its `{id, relevance}` into
 * the SAME RankedRecord contract aiRankRecords already returns and keep the deterministic
 * trust layer: each record's rationale is grounded against its own title/abstract exactly
 * as the Claude path grounds Claude's rationale. Rejects on any engine failure so the
 * caller falls back to the Claude path — never logs record text.
 */
async function asreviewRank(
  records: RankableRecord[],
  labeled: PriorDecision[]
): Promise<AiRankResult> {
  const byId = new Map(records.map((r) => [r.id, r]));

  // Only include/exclude carry a training signal; uncertain decisions are dropped.
  const engineLabels = labeled
    .filter((d) => d.decision === "include" || d.decision === "exclude")
    .map((d) => ({ id: d.id, label: (d.decision === "include" ? 1 : 0) as 0 | 1 }));

  // The engine ranks the UNLABELED records — those without a prior decision.
  const labeledIds = new Set(labeled.map((d) => d.id));
  const unlabeled = records.filter((r) => !labeledIds.has(r.id));

  const result = await rankRecords({
    records: unlabeled.map((r) => ({
      id: r.id,
      title: r.title,
      abstract: r.abstract ?? "",
    })),
    labeled: engineLabels,
  });

  const ranked: RankedRecord[] = [];
  const rankedIds = new Set<string>();

  for (const item of result.ranking) {
    const id = String(item.id);
    const record = byId.get(id);
    if (!record || rankedIds.has(id)) continue;
    rankedIds.add(id);

    // ASReview scores relevance but produces no free-text rationale; a deterministic,
    // record-derived rationale keeps the trust layer honest (it is grounded in the
    // record's own text, never fabricated) and keeps the RankedRecord contract intact.
    const rationale = `Active-learning relevance from prior screening decisions: ${record.title}`;
    ranked.push({
      id: record.id,
      title: record.title,
      relevance: item.relevance,
      // Relevance is a triage score, not an include/exclude judgement — 'uncertain'
      // is the honest verdict, mirroring the Claude path's preference for it.
      verdict: "uncertain",
      rationale,
      groundingOk: isRationaleGrounded(rationale, record),
    });
  }

  // Most-likely-relevant first — same ordering guarantee as the Claude path.
  ranked.sort((a, b) => b.relevance - a.relevance);

  const unrankedIds = records.filter((r) => !rankedIds.has(r.id)).map((r) => r.id);
  return { ranked, unrankedIds };
}

/**
 * Rank an entire set of pending records for a review by relevance to its inclusion
 * criteria. Batches efficiently across many abstracts (heavy Claude use at scale),
 * grounds each rationale against the record's own abstract (trust layer), and returns
 * the records sorted most-relevant-first so the reviewer screens the highest-value
 * records first. Pure orchestration over the records passed in — no DB, no network
 * beyond the Claude calls. Does not mutate its inputs.
 */
export async function aiRankRecords(params: {
  criteria: string[];
  records: RankableRecord[];
  /**
   * Prior human include/exclude decisions on some records. When present AND the
   * opt-in ASReview engine is enabled, they train the active learner that re-ranks
   * the rest. Absent (the default) → the Claude ranking path runs unchanged.
   */
  labeled?: PriorDecision[];
}): Promise<AiRankResult> {
  const { criteria, records, labeled } = params;
  if (records.length === 0) {
    return { ranked: [], unrankedIds: [] };
  }

  // Opt-in ASReview active learner: only when enabled AND there is labeled training
  // data to learn from. On ANY rejection (or no labels), fall through to the existing
  // Claude ranking path below, unchanged.
  if (isAsreviewEnabled() && labeled && labeled.length > 0) {
    try {
      return await asreviewRank(records, labeled);
    } catch {
      // Engine unavailable/failed — fall back to the Claude path. Never log record text.
    }
  }

  const byId = new Map(records.map((r) => [r.id, r]));

  // Batch across records. Batches are independent, so run them concurrently — this is
  // where the real per-abstract Claude reasoning scales across the whole review.
  const batches = chunk(records, BATCH_SIZE);
  const batchResults = await Promise.all(
    batches.map((batch) => rankBatch(criteria, batch))
  );

  const ranked: RankedRecord[] = [];
  const rankedIds = new Set<string>();

  for (const items of batchResults) {
    for (const item of items) {
      const record = byId.get(item.id);
      if (!record) continue;
      rankedIds.add(item.id);
      ranked.push({
        id: record.id,
        title: record.title,
        relevance: item.relevance,
        verdict: item.verdict as ScreeningVerdict,
        rationale: item.rationale,
        groundingOk: isRationaleGrounded(item.rationale, record),
      });
    }
  }

  // Most-likely-relevant first — the whole point of active-learning triage.
  ranked.sort((a, b) => b.relevance - a.relevance);

  const unrankedIds = records.filter((r) => !rankedIds.has(r.id)).map((r) => r.id);
  return { ranked, unrankedIds };
}
