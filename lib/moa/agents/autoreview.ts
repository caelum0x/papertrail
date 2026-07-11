// PaperTrail MoA v2 — AUTOREVIEW agent (category: deliberation).
//
// COMPOSITION ROLE (LAYER 3 · DELIBERATION): autoreview does NOT classify or vote. It is a
// citation-grounded literature-review assembler — a productionization of eimenhmdt/autoresearcher
// (backend/engines/autoresearcher-eimenhmdt). It CONSUMES the per-source SUPPORTS/REFUTES/NEI
// labels MiniCheck PRODUCED (`source_labels`), paper-qa's per-source `quality` weights, and (when
// present) scispaCy's grounded `entities`, then assembles ONE grounded review skeleton: the top
// grounded SUPPORTING spans and the top grounded REFUTING spans, each ordered by its source's
// quality weight. Every citation is a VERBATIM located substring of the real source text — the
// same grounding invariant every other agent obeys (lib/grounding.locateSpan).
//
// PRODUCES: ["research_brief"] — a ResearchBriefFinding { summary, citations: GroundedSpan[] }.
// CONSUMES: ["source_labels", "quality", "entities"] — labels give the supporting/refuting spans;
//   quality orders them by credibility weight; entities (optional) enrich the connective summary.
//   Because the review is built ON MiniCheck's labels, the scheduler orders autoreview AFTER
//   MiniCheck; if that artifact is absent/empty at run time it degrades honestly (skippedContribution).
//
// MOAT: no verdict, rank, or count here is LLM-decided. The citations, their ordering, and the
// deterministic summary are computed from the grounded upstream labels + quality weights alone.
// Claude (honored ONLY when ctx.options.llm) rewrites ONLY the connective PROSE of the summary,
// and only over the citations already selected — it can never add a source, a quote, or a claim.
// A review SUMMARIZES; it does not add an independent vote, so it always votes `neutral` with
// confidence = coverage (fraction of labeled sources that contributed a grounded citation).
//
// UPGRADES the v1 research pattern (backend/moa-v1-adapters/*) to the v2 composition contract:
// v1 engines read inline source fields; v2 reads MiniCheck's PRODUCED `source_labels` and
// paper-qa's `quality` off the blackboard, and PRODUCES the `research_brief` artifact for the trace.
//
// Stateless: no DB pool, no network beyond the single grounded prose call the Claude helper makes
// internally, and only when ctx.options.llm is true. If fewer than two grounded sources are
// available upstream, autoreview SKIPS honestly rather than assemble a one-sided or empty review.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  MoaSource,
  SourceLabel,
  SourceQuality,
  EntityMention,
  ResearchBriefFinding,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import { locateSpan } from "../../grounding";

const AGENT_ID = "autoreview";

// Deliberation: eligible when there are at least two sources, so the upstream labels can supply
// enough grounded material for a citation-grounded review. Moderate weight — a review organizes
// context, it does not vote — mirroring the deliberation gate in storm.ts.
const GATE_ELIGIBLE = 0.5;

// A review needs at least this many labeled+grounded sources to be worth assembling.
const MIN_GROUNDED_SOURCES = 2;

// Cap citations per side so the brief stays a compact skeleton, not a dump.
const MAX_CITATIONS_PER_SIDE = 5;

// A decisive review side: SUPPORTS or REFUTES (NEI / unlabeled sources cite no direction).
type DecisiveLabel = "SUPPORTS" | "REFUTES";

function hasUsableText(source: MoaSource): boolean {
  return typeof source.text === "string" && source.text.trim().length > 0;
}

// A source's quality weight from paper-qa's `quality` artifact. Missing quality (or a source
// absent from it) => a neutral 0.5 so ordering is stable and no source is silently zeroed out.
function qualityWeightFor(quality: SourceQuality | undefined, sourceId: string): number {
  if (quality === undefined) return 0.5;
  const entry = quality.weightById[sourceId];
  if (entry === undefined) return 0.5;
  return clamp01(entry.weight);
}

// One grounded citation candidate assembled from a decisive upstream label. `span` is a VERBATIM
// located substring of the source text (never the label's or model's paraphrase) — re-grounded
// here via locateSpan against the real source, so an ungroundable label contributes nothing.
interface Candidate {
  sourceId: string;
  side: DecisiveLabel;
  weight: number;
  order: number;
  span: GroundedSpan;
}

// Re-ground a label's supporting span against its source text and return a verbatim GroundedSpan,
// or null when the label carried no span OR the text can no longer be located (drop ungroundable).
function groundLabel(
  label: SourceLabel,
  sourceById: ReadonlyMap<string, MoaSource>
): GroundedSpan | null {
  if (label.span === null) return null;
  const source = sourceById.get(label.sourceId);
  if (source === undefined || !hasUsableText(source)) return null;
  const located = locateSpan(source.text, label.span.text);
  if (located === null) return null;
  return {
    sourceId: label.sourceId,
    text: located.text,
    start: located.start,
    end: located.end,
  };
}

// Build the grounded citation candidates from the decisive upstream labels, dropping any whose
// span cannot be re-grounded. Deterministic: input (label) order is preserved for stable ranking.
function buildCandidates(
  labels: readonly SourceLabel[],
  sourceById: ReadonlyMap<string, MoaSource>,
  quality: SourceQuality | undefined
): Candidate[] {
  const candidates: Candidate[] = [];
  labels.forEach((label, order) => {
    if (label.label !== "SUPPORTS" && label.label !== "REFUTES") return; // NEI / other: no citation.
    const span = groundLabel(label, sourceById);
    if (span === null) return; // ungroundable => dropped, never fabricated.
    candidates.push({
      sourceId: label.sourceId,
      side: label.label,
      weight: qualityWeightFor(quality, label.sourceId),
      order,
      span,
    });
  });
  return candidates;
}

// Order one side by quality weight (desc), then sourceId (asc), then original order (asc), and
// truncate to the per-side cap. Deterministic and pure — returns a NEW array.
function orderSide(candidates: readonly Candidate[], side: DecisiveLabel): Candidate[] {
  return [...candidates]
    .filter((c) => c.side === side)
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
      return a.order - b.order;
    })
    .slice(0, MAX_CITATIONS_PER_SIDE);
}

// A deterministic, safe one-line review summary from the grounded counts alone — the fallback
// when Claude is disabled, and the seed the connective-prose step is allowed to rewrite.
function deterministicSummary(
  supportingCount: number,
  refutingCount: number,
  entityNames: readonly string[]
): string {
  const topic = entityNames.length > 0 ? ` on ${entityNames.slice(0, 3).join(", ")}` : "";
  if (supportingCount > 0 && refutingCount > 0) {
    return `Citation-grounded review${topic}: ${supportingCount} source(s) support and ${refutingCount} refute the claim, ordered by source quality.`;
  }
  if (supportingCount > 0) {
    return `Citation-grounded review${topic}: ${supportingCount} source(s) support the claim, ordered by source quality.`;
  }
  return `Citation-grounded review${topic}: ${refutingCount} source(s) refute the claim, ordered by source quality.`;
}

// Distinct, human-readable entity names from scispaCy's grounded mentions (optional enrichment
// for the summary only — never a citation). Deterministic first-seen order, capped by the caller.
function entityNamesFrom(entities: readonly EntityMention[] | undefined): string[] {
  if (entities === undefined) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const mention of entities) {
    const name = mention.text.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

// Prompt for the OPTIONAL connective prose. Claude receives ONLY the citation texts already
// selected and the counts — it may rewrite the one-line summary as neutral connective prose, but
// it must not add evidence, take a verdict, or cite anything not handed to it.
const PROSE_SYSTEM =
  "You are a literature-review editor for PaperTrail. You are given a CLAIM, the number of " +
  "supporting vs refuting sources ALREADY selected for you, and the verbatim quotes chosen " +
  "as citations. Write ONE neutral sentence summarizing the state of the evidence for a " +
  "reader. You must NOT invent evidence, cite anything not listed, take a verdict, or add " +
  "numbers not given. Return ONLY JSON of shape {\"summary\": string}.";

// A minimal shape parser (no zod dep needed here) for the connective-prose response. Anything
// that is not a non-empty string summary is rejected and the deterministic summary is kept.
interface ProseResponse {
  summary: string;
}
function parseProse(value: unknown): ProseResponse {
  if (typeof value !== "object" || value === null) {
    throw new Error("prose response not an object");
  }
  const summary = (value as Record<string, unknown>).summary;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("prose response missing summary");
  }
  return { summary: summary.trim().slice(0, 600) };
}

// Forbidden tokens that would turn neutral connective prose into an implicit verdict, a causation
// claim, or an unquantified strength assertion — none of which autoreview is allowed to make (the
// verdict is decided deterministically downstream, never worded here). Matched case-insensitively
// as whole words so the neutral noun "evidence" or the source-count verbs in the deterministic
// fallback are never the thing being screened (we only screen CLAUDE's rewrite, below).
const FORBIDDEN_PROSE_TOKENS: readonly string[] = [
  // verdict / conclusion language
  "conclude",
  "concludes",
  "concluded",
  "conclusion",
  "conclusive",
  "inconclusive",
  "prove",
  "proves",
  "proven",
  "proved",
  "demonstrate",
  "demonstrates",
  "demonstrated",
  "confirm",
  "confirms",
  "confirmed",
  "establish",
  "establishes",
  "established",
  "verified",
  "refuted",
  "disproven",
  "debunk",
  "debunks",
  "debunked",
  // hedged-verdict / strength assertions that quantify without a given number
  "suggests",
  "suggesting",
  "indicates",
  "indicating",
  "implies",
  "implying",
  "strongly",
  "clearly",
  "definitively",
  "convincingly",
  "compelling",
  "robustly",
  "overwhelming",
  "conclusively",
  // causation claims
  "causes",
  "caused",
  "causing",
  "causal",
  "causation",
  "leads to",
  "results in",
  "due to",
  "because of",
];

// Whole-word (or whole-phrase for multi-word tokens) match so we do not false-positive on
// substrings (e.g. "cause" inside "because" is handled by listing the exact phrases we forbid).
function violatesNeutralProse(prose: string): boolean {
  const lower = prose.toLowerCase();
  return FORBIDDEN_PROSE_TOKENS.some((token) => {
    // Word-boundary regex; tokens are literal (no regex metachars in the list above).
    const pattern = new RegExp(`(^|[^a-z])${token}([^a-z]|$)`, "i");
    return pattern.test(lower);
  });
}

function buildProseUser(
  claim: string,
  supporting: readonly Candidate[],
  refuting: readonly Candidate[]
): string {
  const cite = (c: Candidate): string => `- [${c.side}] ${c.span.text}`;
  return [
    `CLAIM:\n${claim}`,
    "",
    `SUPPORTING SOURCES SELECTED: ${supporting.length}`,
    `REFUTING SOURCES SELECTED: ${refuting.length}`,
    "",
    "CITATIONS (verbatim, do not alter or add to):",
    ...supporting.map(cite),
    ...refuting.map(cite),
    "",
    "Write one neutral summary sentence. No verdict, no new numbers, no new citations.",
  ].join("\n");
}

// Request the connective prose from Claude, reusing the shared JSON helper the debate synthesizer
// uses. Any failure (or disabled LLM) falls back to the deterministic summary — the brief is
// always valid without it. Imported lazily so pure/offline paths never load the SDK.
async function connectiveSummary(
  claim: string,
  supporting: readonly Candidate[],
  refuting: readonly Candidate[],
  fallback: string
): Promise<string> {
  try {
    const { callClaudeForJson } = await import("../../claude");
    const raw = await callClaudeForJson({
      system: PROSE_SYSTEM,
      user: buildProseUser(claim, supporting, refuting),
      schema: { parse: parseProse },
      maxTokens: 256,
    });
    // Post-hoc guard: the prompt forbids verdict/causation/strength language, but a prose that
    // sneaks it in would silently violate the neutral-prose contract. Screen CLAUDE's rewrite
    // ONLY (never the deterministic fallback) and reject to the deterministic summary if it does.
    if (violatesNeutralProse(raw.summary)) {
      return fallback;
    }
    return raw.summary;
  } catch {
    return fallback;
  }
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "AutoReview (citation-grounded literature review)",
  category: "deliberation",
  description:
    "Deliberation: consumes MiniCheck's per-source labels and paper-qa's quality weights to " +
    "assemble a citation-grounded review skeleton — the top grounded supporting and refuting " +
    "spans ordered by source quality — and summarizes the evidence without adding a vote.",

  // Deliberation: produces the `research_brief` artifact (the assembled grounded review).
  produces: ["research_brief"] as const,
  // Composition: MiniCheck's labels supply the citations, paper-qa's quality orders them, and
  // scispaCy's entities (optional) enrich the summary. Scheduler orders autoreview after them.
  consumes: ["source_labels", "quality", "entities"] as const,

  // ELIGIBILITY: pure + deterministic over the INPUT only (never the blackboard). Eligible at
  // GATE_ELIGIBLE when >= 2 sources carry usable text, since the upstream labels can then supply
  // enough grounded material for a review; otherwise 0. No I/O, no LLM, never throws.
  gate(ctx: OrchestrationContext): number {
    if (ctx.claim.trim().length === 0) return 0;
    const usable = ctx.sources.filter(hasUsableText).length;
    return usable >= MIN_GROUNDED_SOURCES ? GATE_ELIGIBLE : 0;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    try {
      // COMPOSE: read the upstream artifacts. `source_labels` is the load-bearing dependency —
      // without it (MiniCheck skipped / disabled) there are no grounded citations to assemble.
      const labels = bb.get("source_labels");
      if (labels === undefined || labels.length === 0) {
        return skippedContribution(
          AGENT_ID,
          "No per-source labels available upstream (MiniCheck did not produce source_labels); no citations to assemble a review."
        );
      }

      const quality: SourceQuality | undefined = bb.get("quality");
      const entities: EntityMention[] | undefined = bb.get("entities");

      const sourceById = new Map<string, MoaSource>(
        ctx.sources.map((s) => [s.id, s] as const)
      );

      // Build grounded citation candidates from the decisive labels, dropping the ungroundable.
      const candidates = buildCandidates(labels, sourceById, quality);
      const distinctSources = new Set<string>(candidates.map((c) => c.sourceId));
      if (distinctSources.size < MIN_GROUNDED_SOURCES) {
        return skippedContribution(
          AGENT_ID,
          "Fewer than two sources carry a grounded supporting/refuting citation; not enough to assemble a review."
        );
      }

      // Order each side by quality weight — the review skeleton the citations become.
      const supporting = orderSide(candidates, "SUPPORTS");
      const refuting = orderSide(candidates, "REFUTES");
      const selected = [...supporting, ...refuting];

      // Confidence = review UTILITY, calibrated to the breadth of grounded sources it actually
      // cites rather than penalizing it for labels that were ungroundable through no fault of the
      // review. Once we ground MIN_GROUNDED_SOURCES distinct sources we have a real, useful review,
      // so the metric saturates at 1.0 there (distinct / max(distinct, MIN_GROUNDED_SOURCES)); a
      // partially-grounded review below the floor still reads honestly lower. Deterministic — no
      // LLM touches this number. `labeledCount` is retained for the trace only (see detail below).
      const labeledCount = labels.filter(
        (l) => l.label === "SUPPORTS" || l.label === "REFUTES"
      ).length;
      const coverage = clamp01(
        distinctSources.size /
          Math.max(distinctSources.size, MIN_GROUNDED_SOURCES)
      );

      const entityNames = entityNamesFrom(entities);
      const baseSummary = deterministicSummary(
        supporting.length,
        refuting.length,
        entityNames
      );

      // Claude writes ONLY the connective prose, and ONLY when the orchestrator allows it. The
      // citation set + ordering + coverage are deterministic regardless.
      const usedClaude = ctx.options.llm === true;
      const summaryText = usedClaude
        ? await connectiveSummary(ctx.claim.trim(), supporting, refuting, baseSummary)
        : baseSummary;

      // The grounded citations are the review's spans — verbatim located substrings, ordered
      // supporting-first then refuting, exactly as assembled above.
      const citations: GroundedSpan[] = selected.map((c) => c.span);

      // PRODUCE: the research_brief artifact the UI trace / downstream read via bb.get("research_brief").
      const researchBrief: ResearchBriefFinding = {
        summary: summaryText,
        citations,
      };

      return makeContribution(AGENT_ID, {
        ran: true,
        // A review summarizes; it does not add an independent vote.
        signal: "neutral",
        confidence: coverage,
        summary: baseSummary,
        detail: {
          supportingCitationCount: supporting.length,
          refutingCitationCount: refuting.length,
          totalCitationCount: citations.length,
          groundedSourceCount: distinctSources.size,
          labeledSourceCount: labeledCount,
          coverage: Number(coverage.toFixed(4)),
          // Composition provenance: what upstream artifacts autoreview actually consumed.
          labelsProducer: bb.producerOf("source_labels") ?? null,
          qualityProducer: bb.producerOf("quality") ?? null,
          entitiesProducer: bb.producerOf("entities") ?? null,
          consumedQuality: quality !== undefined,
          consumedEntities: entities !== undefined,
          entityNames: entityNames.slice(0, 5),
          usedProse: usedClaude,
          citations: selected.map((c) => ({
            sourceId: c.sourceId,
            side: c.side,
            weight: Number(c.weight.toFixed(4)),
            start: c.span.start,
            end: c.span.end,
          })),
        },
        groundedSpans: citations,
        usedClaude,
        produced: { research_brief: researchBrief },
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
