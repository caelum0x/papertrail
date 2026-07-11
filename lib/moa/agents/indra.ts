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
// The `entities` dependency is SOFT and used two ways: (1) CURIE tagging of participants,
// and (2) a corroboration signal — the fraction of mechanism participants that match a
// grounded upstream entity feeds the agent's confidence (see the confidence math in run).
// If `entities` is absent/empty we degrade honestly (no CURIE enrichment, no corroboration
// lift); mechanisms are still produced because CURIEs are optional, not required.
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

// Escape regex metacharacters so a cue is matched literally. Our cues are plain a-z
// words today, but escaping keeps the boundary match correct if a cue ever contains a
// character the regex engine would otherwise interpret.
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Precompile one case-insensitive, word-boundary regex per cue. `\b` gives a TRUE word
// boundary regardless of surrounding hyphens, apostrophes, underscores, or punctuation,
// so "trivial" never fires "via" and "state-mechanism" never fires "mechanism" as a
// compound — while a standalone "mechanism." (trailing punctuation) still matches.
const CAUSAL_CUE_PATTERNS: readonly RegExp[] = CAUSAL_CUES.map(
  (cue) => new RegExp("\\b" + escapeRegex(cue) + "\\b", "i")
);

function claimIsMechanistic(claim: string): boolean {
  // Deterministic, pure: a real word-boundary test over the claim. No LLM.
  return CAUSAL_CUE_PATTERNS.some((pattern) => pattern.test(claim));
}

// Result of assembling the grounding context: the concatenated text plus how many of
// the available parts (claim + source bodies) we actually included. `truncated` is true
// when we dropped one or more whole parts to stay within MAX_TEXT_CHARS.
interface ContextTextResult {
  text: string;
  partsIncluded: number;
  partsAvailable: number;
  truncated: boolean;
}

// Concatenate the claim + all source bodies into one grounding context. Each source is
// separated by a blank line so quotes remain locatable and offsets stay stable. The returned
// text is what the engine grounds against — grounded offsets index into it.
//
// Truncation happens at WHOLE-PART boundaries BEFORE joining: we accumulate parts and stop
// before appending one that would push the joined length past MAX_TEXT_CHARS. This never
// splits a source body mid-sentence or mid-word, so every span the engine grounds is a clean
// substring of a complete part rather than of a body sliced in half.
function buildContextText(ctx: OrchestrationContext): ContextTextResult {
  const available: string[] = [];
  const claim = ctx.claim.trim();
  if (claim.length > 0) available.push(claim);
  for (const source of ctx.sources) {
    const body = source.text.trim();
    if (body.length > 0) available.push(body);
  }

  const SEP = "\n\n";
  const included: string[] = [];
  let length = 0;
  for (const part of available) {
    // Projected joined length if we append this part (separator only between parts).
    const projected = length + (included.length > 0 ? SEP.length : 0) + part.length;
    // Always include the first part even if it alone exceeds the budget, then hard-cap it
    // below, so we never emit empty context when a single body is huge.
    if (included.length > 0 && projected > MAX_TEXT_CHARS) break;
    included.push(part);
    length = projected;
  }

  // Safety cap for the degenerate single-oversized-part case. For the normal multi-part
  // path this is a no-op because we stopped at a whole-part boundary above.
  const joined = included.join(SEP);
  const text = joined.length > MAX_TEXT_CHARS ? joined.slice(0, MAX_TEXT_CHARS) : joined;

  return {
    text,
    partsIncluded: included.length,
    partsAvailable: available.length,
    truncated: included.length < available.length || text.length < joined.length,
  };
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
    const context = buildContextText(ctx);
    const contextText = context.text;
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
      //
      // FIX (robustness): only KEEP statements whose primary evidence grounds verbatim in the
      // exact text we passed. The engine already drops ungroundable candidates, but its
      // primary-evidence offsets are re-verified here against `contextText` — a statement whose
      // span cannot be reproduced verbatim is skipped entirely rather than emitted with a null
      // span, so every produced mechanism carries a real, checkable quote. We track how many we
      // dropped so a high drop rate can lower confidence and surface in the trace.
      const mechanisms: CausalStatement[] = [];
      const groundedSpans: GroundedSpan[] = [];
      let curieTaggedCount = 0;
      let ungroundableDropped = 0;
      // FIX (composition): count how many DISTINCT participants across the kept mechanisms
      // actually match a grounded upstream entity — this is the real strength of the
      // enricher/entities data flow, not just whether the `entities` artifact was present.
      const participantsSeen = new Set<string>();
      const participantsMatched = new Set<string>();
      for (const stmt of result.statements) {
        const span = spanFromStatement(stmt, contextText);
        if (span === null) {
          // Could not reproduce this statement's quote verbatim in our context — do not emit
          // an unsourced mechanism. Grounded spans stay verbatim; unmatchable ones are dropped.
          ungroundableDropped += 1;
          continue;
        }
        const causal = toCausalStatement(stmt, span, curieIndex);
        mechanisms.push(causal);
        groundedSpans.push(span);
        if (causal.subject !== stmt.subj || causal.object !== stmt.obj) curieTaggedCount += 1;

        for (const participant of [stmt.subj, stmt.obj]) {
          const key = participant.trim().toLowerCase();
          if (key.length === 0) continue;
          participantsSeen.add(key);
          if (curieFor(participant, curieIndex) !== null) participantsMatched.add(key);
        }
      }

      // If grounding re-verification dropped every statement, we have nothing checkable to
      // produce — skip honestly rather than emit a mechanism-less "ran" contribution.
      if (mechanisms.length === 0) {
        return skippedContribution(
          AGENT_ID,
          `No mechanism could be grounded verbatim in the provided context ` +
            `(${ungroundableDropped} assembled statement(s) failed verbatim re-grounding).`
        );
      }

      // FIX (calibration): confidence reflects the RICHNESS + CORROBORATION of the kept
      // findings, NOT the epistemic belief that one statement is true. It combines:
      //   • richness  = kept mechanisms per available context part, so a single lonely
      //     mechanism over many sources scores lower than several over a few;
      //   • grounding = fraction of assembled statements that survived verbatim re-grounding,
      //     penalizing runs where the engine's spans do not reproduce;
      //   • corroboration = fraction of participants matched to grounded upstream entities,
      //     rewarding genuine composition with the `entities` producer.
      // All three are deterministic code (counts + ratios) — no LLM number is load-bearing.
      const richness = clamp01(mechanisms.length / (1 + context.partsAvailable));
      const assembledTotal = mechanisms.length + ungroundableDropped;
      const groundingRate = assembledTotal > 0 ? mechanisms.length / assembledTotal : 1;
      const participantMatchRate =
        participantsSeen.size > 0 ? participantsMatched.size / participantsSeen.size : 0;
      // Base on richness gated by how cleanly it grounded; lift modestly when upstream
      // entities corroborate the participants. Kept in [0,1] via clamp01.
      const confidence = clamp01(
        richness * groundingRate * (0.75 + 0.25 * participantMatchRate)
      );

      // topBelief is retained for the trace + human-readable summary only — it is NOT the
      // agent's contribution confidence (see the decoupling above).
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
        `Assembled ${mechanisms.length} grounded mechanism statement(s)` +
        (ungroundableDropped > 0 ? ` (${ungroundableDropped} dropped as ungroundable)` : "") +
        (entitiesConsumed > 0 ? ` (${curieTaggedCount} CURIE-tagged from entities)` : "") +
        (context.truncated ? " (context truncated at a source boundary)" : "") +
        (top
          ? `; strongest ${top.subj} ${top.relation} ${top.obj} (belief ${topBelief.toFixed(2)}).`
          : ".");

      return makeContribution(AGENT_ID, {
        ran: true,
        // Mechanism is corroborating CONTEXT for the verdict, never a support/refute vote.
        signal: "neutral",
        confidence,
        summary,
        usedClaude: useLlm,
        groundedSpans,
        produced: { mechanisms },
        detail: {
          statementCount: mechanisms.length,
          assembledStatementCount: assembledTotal,
          ungroundableDropped,
          groundingRate: Number(groundingRate.toFixed(4)),
          richness: Number(richness.toFixed(4)),
          participantMatchRate: Number(participantMatchRate.toFixed(4)),
          participantsSeen: participantsSeen.size,
          participantsMatched: participantsMatched.size,
          confidence: Number(confidence.toFixed(4)),
          topBelief,
          groundingDroppedCount: result.groundingDroppedCount,
          entitiesConsumed,
          curieTaggedCount,
          contextTruncated: context.truncated,
          contextPartsIncluded: context.partsIncluded,
          contextPartsAvailable: context.partsAvailable,
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
