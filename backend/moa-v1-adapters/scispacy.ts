// PaperTrail MoA expert · scispaCy biomedical NER + entity linking (CONTEXT expert).
//
// Wraps lib/entities/ner.recognizeEntities — a native TypeScript port of scispaCy's
// pipeline: Claude proposes candidate biomedical mentions (the ONLY LLM step), a native
// Schwartz-Hearst pass resolves abbreviations, lib/grounding places each mention verbatim
// in the text (dropping the ungroundable), and a DETERMINISTIC in-code linker maps each
// grounded mention to a normalized concept id (UMLS CUI / MeSH). This expert runs that
// path over the claim plus every source and reports the grounded, linked entities.
//
// It contributes CONTEXT (which biomedical entities the claim/sources are about, mapped
// to auditable concept ids) rather than a support/refute vote, so its signal is always
// `neutral`. Confidence is a DETERMINISTIC function of how many entities were grounded
// and linked — never an LLM number (the linker score is a string-match number).
//
// Stateless: owns no DB pool and opens no network beyond the Claude call the engine's NER
// step already makes internally, and only when ctx.options.llm is true. When the Claude
// step is disabled it skips honestly, because NER has no deterministic-only fallback.

import type {
  Expert,
  OrchestrationContext,
  ExpertContribution,
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

const EXPERT_ID = "scispacy";

// A single text unit fed to the NER pipeline. Sources keep their real id; the claim is a
// synthetic unit so its grounded entities are attributable in the detail panel.
interface TextUnit {
  sourceId: string;
  text: string;
  isClaim: boolean;
}

// A linked entity row surfaced to the detail panel: text + concept id + type only, never
// the raw source body.
interface LinkedEntityDetail {
  sourceId: string;
  text: string;
  type: LinkedEntity["type"];
  curie: string | null;
  canonicalName: string | null;
  linkScore: number;
  abbreviationOf: string | null;
}

const CLAIM_UNIT_ID = "__claim__";

function hasText(text: string): boolean {
  return text.trim().length > 0;
}

// Collect the claim and every non-empty source into text units to run NER over.
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

const expert: Expert = {
  id: EXPERT_ID,
  name: "scispaCy NER + Entity Linking",
  category: "bio-kg",
  description:
    "Biomedical named-entity recognition + linking: extracts gene/disease/chemical/variant " +
    "mentions from the claim and sources, grounds them verbatim, and links them to normalized " +
    "concept ids (UMLS/MeSH). Provides entity context; casts no support/refute vote.",

  // Low-moderate, always-useful relevance: named entities are helpful context on any
  // biomedical claim, so gate ~0.4 whenever there is at least one text unit (claim or a
  // source with body text) to extract from. Nothing to read at all -> gate 0.
  gate(ctx: OrchestrationContext): number {
    const units = (hasText(ctx.claim) ? 1 : 0) +
      ctx.sources.filter((s) => hasText(s.text)).length;
    if (units === 0) return 0;
    return clamp01(0.4);
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    const units = collectUnits(ctx);
    if (units.length === 0) {
      return skippedContribution(
        EXPERT_ID,
        "No claim or source text to recognize entities in."
      );
    }

    // The NER step is the engine's only Claude call and has no deterministic-only
    // fallback (the trained-model stand-in IS the model). If the Claude step is disabled,
    // skip honestly rather than emit an empty entity set as if none existed.
    if (!ctx.options.llm) {
      return skippedContribution(
        EXPERT_ID,
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

      // Flatten grounded, linked entities. Every span comes from the engine's grounded
      // output (verbatim substring + offsets), so groundedSpans never fabricate a quote.
      const detailRows: LinkedEntityDetail[] = [];
      const groundedSpans: GroundedSpan[] = [];
      let totalEntities = 0;
      let totalLinked = 0;
      let totalGroundingDropped = 0;

      for (const { unit, result } of results) {
        totalEntities += result.entities.length;
        totalLinked += result.linkedCount;
        totalGroundingDropped += result.groundingDroppedCount;

        for (const entity of result.entities) {
          detailRows.push({
            sourceId: unit.sourceId,
            text: entity.text,
            type: entity.type,
            curie: entity.link.normalizedId,
            canonicalName: entity.link.canonicalName,
            linkScore: entity.link.score,
            abbreviationOf: entity.abbreviationOf,
          });
          // Surface only entities that grounded against a real source (not the synthetic
          // claim unit) as MoA grounded spans — they must map to a named MoaSource.
          if (!unit.isClaim) {
            groundedSpans.push({
              sourceId: unit.sourceId,
              text: entity.text,
              start: entity.start,
              end: entity.end,
            });
          }
        }
      }

      if (totalEntities === 0) {
        // Ran cleanly but found no groundable biomedical entities — honest, not an error.
        return makeContribution(EXPERT_ID, {
          ran: true,
          signal: "neutral",
          confidence: 0,
          summary: `No biomedical entities grounded across ${units.length} text unit(s).`,
          detail: {
            unitsScanned: units.length,
            totalEntities: 0,
            linkedEntities: 0,
            groundingDroppedCount: totalGroundingDropped,
            linkedEntityList: [],
          },
          groundedSpans: [],
          usedClaude: true,
        });
      }

      // Deterministic confidence: the fraction of grounded entities that resolved to a
      // normalized concept id. More linked entities = richer, auditable context. This is
      // a string-match-derived count, never an LLM number.
      const linkedFraction = totalLinked / totalEntities;
      const confidence = clamp01(linkedFraction);

      const linkedList = detailRows.filter((r) => r.curie !== null);
      const summary =
        `Grounded ${totalEntities} biomedical entit${totalEntities === 1 ? "y" : "ies"} across ` +
        `${units.length} text unit(s); ${totalLinked} linked to a concept id.`;

      return makeContribution(EXPERT_ID, {
        ran: true,
        // Context expert: entities inform the mix, they do not vote on the claim.
        signal: "neutral",
        confidence,
        summary,
        detail: {
          unitsScanned: units.length,
          totalEntities,
          linkedEntities: totalLinked,
          linkedFraction,
          groundingDroppedCount: totalGroundingDropped,
          linkedEntityList: linkedList,
        },
        groundedSpans,
        usedClaude: true,
      });
    } catch (err: unknown) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
