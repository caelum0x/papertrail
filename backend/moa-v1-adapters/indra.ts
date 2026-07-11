// MoA expert adapter — INDRA (category: bio-kg). A native TypeScript port of INDRA's
// causal-statement assembly + belief model, exposed as an interchangeable "expert" agent.
//
// INDRA here is a MECHANISM/CONTEXT expert: it does not vote on whether the claim is
// true. It reads the claim + the concatenated source text and assembles grounded causal
// mechanistic statements — (subject, relation, object) triples, each backed by a verbatim
// quote and scored with a DETERMINISTIC belief. Surfacing the underlying mechanism is
// CORROBORATING CONTEXT for the verdict, not a support/refute vote, so the signal is
// always `neutral`.
//
// Engine lib: lib/mechanism/assemble.ts::assembleMechanisms(input, pool, deps).
//   - Stateless path: we pass pool = null, which runs EXTRACT -> GROUND -> ASSEMBLE ->
//     SCORE and skips KG persistence entirely (edgesUpserted stays 0). No DB pool, no
//     network beyond the Claude extraction the lib already owns internally.
//   - Deterministic numerics: grounding (locateSpan) and belief (1 - prod(1 - r_i)) are
//     pure code. Claude only PROPOSES candidate tuples; no LLM number is load-bearing.
//   - Claude runs ONLY when ctx.options.llm is set (the extraction step). When llm is
//     false there is no deterministic extraction fallback in the engine, so we honestly
//     skip rather than fabricate mechanisms. usedClaude reflects the real invocation.
//   - Grounding: every surfaced span is a verbatim source substring the engine already
//     located (evidence.grounding.{start,end}); we never fabricate a span.

import type { Expert, OrchestrationContext, ExpertContribution, GroundedSpan } from "../types";
import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";
import { assembleMechanisms } from "../../mechanism/assemble";
import type { MechanismStatement } from "../../mechanism/schemas";

const EXPERT_ID = "indra";

// Causal / mechanistic cue words. The engine only assembles mechanism when the text
// asserts a directed relation; gating on these cues in the CLAIM keeps INDRA out of
// purely statistical/efficacy claims that carry no mechanism to assemble.
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

// Gate constants. Mechanism assembly is moderately relevant: it contributes context, not
// a verdict, and only fires on causal claims — so it never gates as high as a verifier.
const GATE_MECHANISTIC = 0.5;
const GATE_NON_MECHANISTIC = 0.05;

// Bound the concatenated text handed to the engine to the lib's own request cap so a
// large multi-source context stays within the extraction contract (never truncate mid
// through a grounded quote silently downstream — the lib grounds against exactly what we pass).
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
// separated by a blank line so quotes remain locatable and offsets stay stable. The
// returned text is what the engine grounds against — grounded offsets index into it.
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

// Map an assembled statement's first (highest-status) grounded evidence to a GroundedSpan.
// The offsets come straight from the engine's locateSpan output over the SAME concatenated
// text, so `contextText.slice(start, end)` is the verbatim quote — never fabricated.
function spansFromStatements(
  statements: readonly MechanismStatement[],
  contextText: string
): GroundedSpan[] {
  const spans: GroundedSpan[] = [];
  const contextSourceId = "context";
  for (const stmt of statements) {
    const primary = stmt.evidence[0];
    if (primary === undefined) continue;
    const { start, end } = primary.grounding;
    // Defensive: only emit a span that is a real substring of the text we grounded against.
    if (contextText.slice(start, end) !== primary.quote) continue;
    spans.push({ sourceId: contextSourceId, text: primary.quote, start, end });
  }
  return spans;
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "INDRA mechanism assembler",
  category: "bio-kg",
  description:
    "Assembles grounded causal mechanistic statements (subject-relation-object) from the " +
    "claim and sources, each backed by a verbatim quote and a deterministic belief. " +
    "Contributes mechanism as corroborating context; does not vote support/refute.",

  // Pure + deterministic: relevance is high only for causal/mechanistic claims that have
  // at least one source with text to assemble mechanism from. No I/O, no LLM, no throwing.
  gate(ctx: OrchestrationContext): number {
    const hasSourceText = ctx.sources.some((s) => s.text.trim().length > 0);
    if (!hasSourceText) return 0;
    if (ctx.claim.trim().length === 0) return 0;
    return claimIsMechanistic(ctx.claim) ? GATE_MECHANISTIC : GATE_NON_MECHANISTIC;
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    const contextText = buildContextText(ctx);
    if (contextText.trim().length === 0) {
      return skippedContribution(EXPERT_ID, "No claim or source text to assemble mechanism from.");
    }

    // The engine's only extraction path uses Claude; there is no deterministic fallback,
    // so with llm disabled we honestly skip rather than invent mechanistic statements.
    const useLlm = ctx.options.llm === true;
    if (!useLlm) {
      return skippedContribution(
        EXPERT_ID,
        "Mechanism extraction requires the Claude language step, which is disabled for this run."
      );
    }

    try {
      // pool = null -> pure stateless EXTRACT -> GROUND -> ASSEMBLE -> SCORE path; no KG
      // write. Tier defaults to the lib's conservative `abstract` reliability.
      const result = await assembleMechanisms({ text: contextText }, null);

      if (result.statements.length === 0) {
        return skippedContribution(
          EXPERT_ID,
          result.groundingDroppedCount > 0
            ? `No groundable mechanism found (${result.groundingDroppedCount} candidate(s) dropped as ungroundable).`
            : "The text asserts no extractable causal mechanism."
        );
      }

      // Confidence = the combined belief of the strongest assembled mechanism (statements
      // are returned belief-sorted). Deterministic: it is the belief math, not an LLM number.
      const topBelief = clamp01(result.statements[0]?.belief ?? 0);

      const groundedSpans = spansFromStatements(result.statements, contextText);

      const statementsDetail = result.statements.slice(0, MAX_DETAIL_STATEMENTS).map((stmt) => ({
        subj: stmt.subj,
        relation: stmt.relation,
        obj: stmt.obj,
        belief: Number(stmt.belief.toFixed(4)),
        evidenceCount: stmt.evidence.length,
      }));

      const summary =
        `Assembled ${result.statements.length} grounded mechanism statement(s); ` +
        `strongest ${result.statements[0]?.subj} ${result.statements[0]?.relation} ` +
        `${result.statements[0]?.obj} (belief ${topBelief.toFixed(2)}).`;

      return makeContribution(EXPERT_ID, {
        ran: true,
        // Mechanism is corroborating CONTEXT for the verdict, never a support/refute vote.
        signal: "neutral",
        confidence: topBelief,
        summary,
        usedClaude: useLlm,
        groundedSpans,
        detail: {
          statementCount: result.statements.length,
          topBelief,
          groundingDroppedCount: result.groundingDroppedCount,
          statements: statementsDetail,
          statementsTruncated: result.statements.length > MAX_DETAIL_STATEMENTS,
        },
      });
    } catch (err: unknown) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
