// PaperTrail MoA v2 — INDRA mechanism enricher (category: bio-kg).
//
// COMPOSITION ROLE: LAYER-1 ENRICHER. INDRA does not vote on whether the claim is true;
// it reads the claim + concatenated source text and ASSEMBLES grounded causal mechanistic
// statements — (subject, relation, object) triples, each backed by a verbatim quote and
// scored with a DETERMINISTIC belief — then PRODUCES them onto the blackboard as the
// `mechanisms` artifact for downstream verifiers/deliberation to consume. Surfacing the
// underlying mechanism is CORROBORATING CONTEXT, not a support/refute vote, so the signal
// is always `neutral`.
//
//   produces: ["mechanisms"]   -> CausalStatement[]  (written via contribution.produced)
//   consumes: ["entities"]      -> EntityMention[]    (OPTIONAL; read from the blackboard)
//
// COMPOSITION with entities: when scispaCy has produced `entities`, we CONSUME them to
// enrich the mechanism payload — we tag each assembled statement's subject/object with the
// grounded CURIE of the matching entity mention when one exists. This is genuine data flow:
// the enricher builds ON TOP of the upstream entity grounding rather than re-deriving it.
// If `entities` is absent/empty we degrade honestly (no CURIE enrichment, unchanged belief).
//
// Engine lib: lib/mechanism/assemble.ts::assembleMechanisms(input, pool, deps).
//   - Stateless path only: pool = null runs EXTRACT -> GROUND -> ASSEMBLE -> SCORE and skips
//     KG persistence entirely (edgesUpserted stays 0). No DB pool, no network beyond the
//     Claude extraction the lib already owns internally.
//   - Deterministic numerics: grounding (locateSpan) and belief (1 - prod(1 - r_i)) are pure
//     code. Claude only PROPOSES candidate tuples; no LLM number is load-bearing.
//   - Claude runs ONLY when ctx.options.llm is set (the extraction step). When llm is false
//     the engine has no deterministic extraction fallback, so we skip honestly rather than
//     fabricate mechanisms. usedClaude reflects the real invocation.
//   - Grounding: every surfaced span is a verbatim source substring the engine already
//     located (evidence.grounding.{start,end}); we never fabricate a span.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  CausalStatement,
  EntityMention,
  GroundedSpan,
} from "../types";
import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";
import { assembleMechanisms } from "../../mechanism/assemble";
import type { MechanismStatement } from "../../mechanism/schemas";

const AGENT_ID = "indra";

// Causal / mechanistic cue words. The engine only assembles a mechanism when the text
// asserts a directed relation; gating on these cues in the CLAIM keeps INDRA out of purely
// statistical/efficacy claims that carry no mechanism to assemble.
const CAUSAL_CUES: readonly string[] = [
  "cause",
  "causes",
  "caused",
  "increase",
  "increases",
  "increased",
  "reduce",
  "reduces",
  "reduced",
  "inhibit",
  "inhibits",
  "inhibited",
  "activate",
  "activates",
  "activated",
  "via",
  "mechanism",
  "pathway",
  "phosphorylate",
  "phosphorylates",
  "binds",
  "regulate",
  "regulates",
  "mediated",
  "mediates",
  "induces",
  "induced",
  "suppress",
  "suppresses",
];

// Gate constants. Mechanism assembly contributes context, not a verdict, and only fires on
// causal claims — so it never gates as high as a verifier.
const GATE_MECHANISTIC = 0.5;
const GATE_NON_MECHANISTIC = 0.15;

// Bound the concatenated text handed to the engine so a large multi-source context stays
// within the extraction contract; the lib grounds against exactly what we pass.
const MAX_TEXT_CHARS = 20_000;

// Cap how many assembled statements we echo into the detail payload so the UI stays light.
const MAX_DETAIL_STATEMENTS = 25;

function claimIsMechanistic(claim: string): boolean {
  const lowered = claim.toLowerCase();
  return CAUSAL_CUES.some((cue) => {
    // Word-boundary-ish match so "via" doesn't fire on "trivial"; cheap + deterministic.
    const idx = lowered.indexOf(cue);
    if (idx < 0) return false;
    const before = idx === 0 ? "" : lowered[idx - 1];
    const after = lowered[idx + cue.length] ?? "";
    const isWordChar = (c: string): boolean => /[a-z0-9]/.test(c);
    return !isWordChar(before) && !isWordChar(after);
  });
}

// Concatenate the claim + all source bodies into one grounding context. Each source is
// separated by a blank line so quotes remain locatable and offsets stay stable. The returned
// text is what the engine grounds against — grounded offsets index into it.
function buildContextText(ctx: OrchestrationContext): string {
  const parts: string[] = [];
  const claim = ctx.claim.trim();
  if (claim.length > 0) parts.push(claim);
  for (const source of ctx.sources) {
    const body = source.text.trim();
    if (body.length > 0) parts.push(body);
  }
  return parts.join("\n\n").slice(0, MAX_TEXT_CHARS);
}

// Build a case-insensitive surface-form -> grounded CURIE index from the upstream entity
// mentions. Only mentions that actually carry a CURIE are indexed; the first CURIE seen for
// a surface form wins (deterministic over a stable-ordered mentions array).
function curieIndexFromEntities(entities: readonly EntityMention[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const mention of entities) {
    const curie = mention.curie;
    if (curie === null || curie.length === 0) continue;
    const key = mention.text.trim().toLowerCase();
    if (key.length === 0) continue;
    if (!index.has(key)) index.set(key, curie);
  }
  return index;
}

// Look up the grounded CURIE for an assembled-statement participant (subject/object) from the
// upstream entity index. Returns null when there is no matching grounded mention.
function curieFor(name: string, index: Map<string, string>): string | null {
  return index.get(name.trim().toLowerCase()) ?? null;
}

// Map an assembled statement's first (highest-status) grounded evidence to a GroundedSpan.
// The offsets come straight from the engine's locateSpan output over the SAME concatenated
// text, so `contextText.slice(start, end)` is the verbatim quote — never fabricated.
function spanFromStatement(
  stmt: MechanismStatement,
  contextText: string
): GroundedSpan | null {
  const primary = stmt.evidence[0];
  if (primary === undefined) return null;
  const { start, end } = primary.grounding;
  // Defensive: only emit a span that is a real substring of the text we grounded against.
  if (contextText.slice(start, end) !== primary.quote) return null;
  return { sourceId: "context", text: primary.quote, start, end };
}

// Convert one engine MechanismStatement into the blackboard CausalStatement artifact shape.
// subject/object are enriched with the upstream grounded CURIE when available (appended in
// brackets so the verbatim surface form is preserved and the CURIE is machine-readable).
function toCausalStatement(
  stmt: MechanismStatement,
  span: GroundedSpan | null,
  curieIndex: Map<string, string>
): CausalStatement {
  const subjCurie = curieFor(stmt.subj, curieIndex);
  const objCurie = curieFor(stmt.obj, curieIndex);
  return {
    subject: subjCurie ? `${stmt.subj} [${subjCurie}]` : stmt.subj,
    relation: stmt.relation,
    object: objCurie ? `${stmt.obj} [${objCurie}]` : stmt.obj,
    belief: clamp01(stmt.belief),
    span,
  };
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "INDRA mechanism assembler",
  category: "bio-kg",
  description:
    "Assembles grounded causal mechanistic statements (subject-relation-object) from the " +
    "claim and sources, each backed by a verbatim quote and a deterministic belief, and " +
    "produces them as the `mechanisms` artifact. Consumes scispaCy entities to tag " +
    "participants with grounded CURIEs. Contributes mechanism as corroborating context; " +
    "does not vote support/refute.",

  produces: ["mechanisms"] as const,
  consumes: ["entities"] as const,

  // Pure + deterministic: relevance is higher for causal/mechanistic claims that have at
  // least one source with text to assemble mechanism from. No blackboard read, no I/O, no
  // LLM, no throwing.
  gate(ctx: OrchestrationContext): number {
    const hasSourceText = ctx.sources.some((s) => s.text.trim().length > 0);
    if (!hasSourceText) return 0;
    if (ctx.claim.trim().length === 0) return 0;
    return claimIsMechanistic(ctx.claim) ? GATE_MECHANISTIC : GATE_NON_MECHANISTIC;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    const contextText = buildContextText(ctx);
    if (contextText.trim().length === 0) {
      return skippedContribution(AGENT_ID, "No claim or source text to assemble mechanism from.");
    }

    // The engine's only extraction path uses Claude; there is no deterministic fallback, so
    // with llm disabled we honestly skip rather than invent mechanistic statements.
    const useLlm = ctx.options.llm === true;
    if (!useLlm) {
      return skippedContribution(
        AGENT_ID,
        "Mechanism extraction requires the Claude language step, which is disabled for this run."
      );
    }

    // COMPOSE: consume the upstream scispaCy `entities` artifact when present so we can tag
    // mechanism participants with grounded CURIEs. Absent/empty -> degrade honestly.
    const entities = bb.get("entities");
    const curieIndex =
      entities && entities.length > 0 ? curieIndexFromEntities(entities) : new Map<string, string>();
    const entitiesConsumed = curieIndex.size;

    try {
      // pool = null -> pure stateless EXTRACT -> GROUND -> ASSEMBLE -> SCORE path; no KG write.
      // Tier defaults to the lib's conservative `abstract` reliability.
      const result = await assembleMechanisms({ text: contextText }, null);

      if (result.statements.length === 0) {
        return skippedContribution(
          AGENT_ID,
          result.groundingDroppedCount > 0
            ? `No groundable mechanism found (${result.groundingDroppedCount} candidate(s) dropped as ungroundable).`
            : "The text asserts no extractable causal mechanism."
        );
      }

      // Build the produced `mechanisms` artifact + the grounded spans in one pass. Statements
      // are returned belief-sorted by the engine, so the strongest mechanism leads.
      const mechanisms: CausalStatement[] = [];
      const groundedSpans: GroundedSpan[] = [];
      let curieTaggedCount = 0;
      for (const stmt of result.statements) {
        const span = spanFromStatement(stmt, contextText);
        const causal = toCausalStatement(stmt, span, curieIndex);
        mechanisms.push(causal);
        if (span) groundedSpans.push(span);
        if (causal.subject !== stmt.subj || causal.object !== stmt.obj) curieTaggedCount += 1;
      }

      // Confidence = the combined belief of the strongest assembled mechanism. Deterministic:
      // it is the belief math, not an LLM number.
      const topBelief = clamp01(result.statements[0]?.belief ?? 0);
      const top = result.statements[0];

      const statementsDetail = result.statements.slice(0, MAX_DETAIL_STATEMENTS).map((stmt) => ({
        subj: stmt.subj,
        relation: stmt.relation,
        obj: stmt.obj,
        belief: Number(stmt.belief.toFixed(4)),
        evidenceCount: stmt.evidence.length,
        subjCurie: curieFor(stmt.subj, curieIndex),
        objCurie: curieFor(stmt.obj, curieIndex),
      }));

      const summary =
        `Assembled ${result.statements.length} grounded mechanism statement(s)` +
        (entitiesConsumed > 0 ? ` (${curieTaggedCount} CURIE-tagged from entities)` : "") +
        (top
          ? `; strongest ${top.subj} ${top.relation} ${top.obj} (belief ${topBelief.toFixed(2)}).`
          : ".");

      return makeContribution(AGENT_ID, {
        ran: true,
        // Mechanism is corroborating CONTEXT for the verdict, never a support/refute vote.
        signal: "neutral",
        confidence: topBelief,
        summary,
        usedClaude: useLlm,
        groundedSpans,
        produced: { mechanisms },
        detail: {
          statementCount: result.statements.length,
          topBelief,
          groundingDroppedCount: result.groundingDroppedCount,
          entitiesConsumed,
          curieTaggedCount,
          statements: statementsDetail,
          statementsTruncated: result.statements.length > MAX_DETAIL_STATEMENTS,
        },
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
