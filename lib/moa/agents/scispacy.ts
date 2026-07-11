// PaperTrail Mixture-of-Agents v2 · scispaCy biomedical NER ENRICHER (LAYER 1).
//
// Composition role: PRODUCER. This agent enriches the blackboard with the artifact
// kind "entities" — the grounded biomedical mentions (gene / disease / chemical /
// variant) the claim and sources are actually about, each mapped to a normalized,
// auditable concept id (a UMLS CUI / MeSH id, i.e. a CURIE). It reads nothing from the
// blackboard (consumes: []); it is a root of the DAG whose EntityMention[] downstream
// agents can later build on. It never votes on the claim — its signal is always
// `neutral`; it contributes CONTEXT, not a support/refute judgement.
//
// Engine: lib/entities/ner.recognizeEntities — a native TypeScript port of scispaCy.
// Claude proposes candidate mentions (the ONLY LLM step, validated at the Zod trust
// boundary), a native Schwartz-Hearst pass resolves abbreviations, lib/grounding places
// each mention verbatim in the text (dropping the ungroundable), and a DETERMINISTIC
// in-code linker maps each grounded mention to a concept id. The engine is stateless:
// it owns no DB pool and opens no network beyond that single Claude call.
//
// Because the trained-model stand-in IS Claude, the NER step has no deterministic-only
// fallback: when ctx.options.llm is false we skip honestly rather than emit an empty
// entity set as if none existed. usedClaude therefore tracks ctx.options.llm truthfully.
// Confidence is a DETERMINISTIC function of how many grounded entities linked to a
// concept id — a string-match-derived fraction, never an LLM number.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  EntityMention,
  GroundedSpan,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import { recognizeEntities } from "../../entities/ner";
import type { LinkedEntity, NerResult } from "../../entities/schemas";

const AGENT_ID = "scispacy";

// A single text unit fed to the NER pipeline. Sources keep their real id; the claim is a
// synthetic unit so its grounded entities are attributable in the detail panel without
// pretending to belong to a named source.
interface TextUnit {
  sourceId: string;
  text: string;
  isClaim: boolean;
}

// Synthetic id for the claim unit. Entities grounded here are surfaced in `detail` for
// context but are NOT emitted as MoA groundedSpans (those must map to a named MoaSource).
const CLAIM_UNIT_ID = "__claim__";

function hasText(text: string): boolean {
  return text.trim().length > 0;
}

// Collect the claim and every non-empty source into text units to run NER over. Pure.
function collectUnits(ctx: OrchestrationContext): TextUnit[] {
  const units: TextUnit[] = [];
  if (hasText(ctx.claim)) {
    units.push({ sourceId: CLAIM_UNIT_ID, text: ctx.claim, isClaim: true });
  }
  for (const source of ctx.sources) {
    if (hasText(source.text)) {
      units.push({ sourceId: source.id, text: source.text, isClaim: false });
    }
  }
  return units;
}

// Map one engine LinkedEntity to the blackboard EntityMention artifact shape. curie is
// the normalized concept id (null when the mention did not resolve above threshold). The
// grounded span is verbatim engine output (located substring + exact offsets), never
// fabricated; the synthetic claim unit carries no span, since spans must reference a
// named MoaSource.
function toEntityMention(unit: TextUnit, entity: LinkedEntity): EntityMention {
  const span: GroundedSpan | null = unit.isClaim
    ? null
    : {
        sourceId: unit.sourceId,
        text: entity.text,
        start: entity.start,
        end: entity.end,
      };
  return {
    sourceId: unit.sourceId,
    text: entity.text,
    curie: entity.link.normalizedId,
    type: entity.type,
    span,
  };
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "scispaCy NER + Entity Linking",
  category: "enricher",
  description:
    "Biomedical named-entity ENRICHER: extracts gene/disease/chemical/variant mentions from " +
    "the claim and sources, grounds each verbatim, and links it to a normalized concept id " +
    "(UMLS CUI / MeSH). PRODUCES the `entities` artifact for downstream agents; casts no vote.",

  // PRODUCER: writes the `entities` artifact. Reads nothing — a DAG root (Layer 1).
  produces: ["entities"],
  consumes: [],

  // Deterministic eligibility from the INPUT ONLY (never the blackboard). Named entities
  // are useful context on any biomedical claim, so gate 0.4 whenever there is at least one
  // text unit with body text (the claim or any source) to extract from; nothing to read
  // at all -> gate 0.
  gate(ctx: OrchestrationContext): number {
    const units =
      (hasText(ctx.claim) ? 1 : 0) +
      ctx.sources.filter((s) => hasText(s.text)).length;
    if (units === 0) return 0;
    return 0.4;
  },

  async run(ctx: OrchestrationContext, _bb: Blackboard): Promise<AgentContribution> {
    // Layer-1 root: nothing to consume. `_bb` is intentionally unread.
    void _bb;

    const units = collectUnits(ctx);
    if (units.length === 0) {
      return skippedContribution(
        AGENT_ID,
        "No claim or source text to recognize entities in."
      );
    }

    // The NER step is the engine's only Claude call and has no deterministic-only
    // fallback (the trained-model stand-in IS the model). If Claude is disabled, skip
    // honestly rather than emit an empty entity set as if none existed. NEVER throw here.
    if (!ctx.options.llm) {
      return skippedContribution(
        AGENT_ID,
        "scispaCy's NER step requires the Claude step, which is disabled."
      );
    }

    try {
      // Run the stateless NER pipeline over each unit. recognizeEntities defaults to the
      // real Claude client for mention proposal; grounding + linking are deterministic.
      const results: Array<{ unit: TextUnit; result: NerResult }> = [];
      for (const unit of units) {
        const result = await recognizeEntities({ text: unit.text });
        results.push({ unit, result });
      }

      // Build the EntityMention[] artifact + the grounded spans. Every span is engine
      // grounded output (verbatim substring + offsets), so we never fabricate a quote.
      const entities: EntityMention[] = [];
      const groundedSpans: GroundedSpan[] = [];
      let totalEntities = 0;
      let totalLinked = 0;
      let totalGroundingDropped = 0;

      for (const { unit, result } of results) {
        totalEntities += result.entities.length;
        totalLinked += result.linkedCount;
        totalGroundingDropped += result.groundingDroppedCount;

        for (const entity of result.entities) {
          const mention = toEntityMention(unit, entity);
          entities.push(mention);
          if (mention.span) groundedSpans.push(mention.span);
        }
      }

      if (totalEntities === 0) {
        // Ran cleanly but found no groundable biomedical entities — honest, not an error,
        // and not a produced artifact (an empty entities set is nothing to compose on).
        return skippedContribution(
          AGENT_ID,
          `No biomedical entities grounded across ${units.length} text unit(s).`
        );
      }

      // Deterministic confidence: the fraction of grounded entities that resolved to a
      // normalized concept id. More linked entities = richer, auditable context. This is
      // a string-match-derived count, never an LLM number.
      const linkedFraction = totalLinked / totalEntities;
      const confidence = clamp01(linkedFraction);

      const summary =
        `Grounded ${totalEntities} biomedical entit${totalEntities === 1 ? "y" : "ies"} across ` +
        `${units.length} text unit(s); ${totalLinked} linked to a concept id.`;

      return makeContribution(AGENT_ID, {
        ran: true,
        // Enricher: entities inform the mix, they do not vote on the claim.
        signal: "neutral",
        confidence,
        summary,
        detail: {
          unitsScanned: units.length,
          totalEntities,
          linkedEntities: totalLinked,
          linkedFraction,
          groundingDroppedCount: totalGroundingDropped,
          // Compact, JSON-serializable rows: labels + ids only, never raw source bodies.
          entities: entities.map((e) => ({
            sourceId: e.sourceId,
            text: e.text,
            type: e.type,
            curie: e.curie,
          })),
        },
        groundedSpans,
        usedClaude: true,
        // PRODUCE the artifact downstream agents compose on.
        produced: { entities },
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
