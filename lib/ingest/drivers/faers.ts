// FAERS ingest driver — wraps lib/bio/pharmacovigilance.assessSafetySignal into a
// cacheable source record.
//
// FAERS disproportionality is a drug×event computation, so this driver needs BOTH a drug
// and an adverse event. It reads them from the pipeline context:
//   - drug  = the resolved entity surface, else the free-text query.
//   - event = an explicit "drug -> event" / "drug: event" split of the query, or the
//             query itself when the entity supplied the drug.
// When it can't resolve a (drug, event) pair, or FAERS returns nothing, it returns []
// (honest empty) — never a fabricated signal. NO LLM anywhere; the numbers are exactly
// what disproportionality() computed.

import { assessSafetySignal } from "@/lib/bio/pharmacovigilance";
import type { CacheableSourceRecord, DriverContext, IngestDriver } from "./types";

const SOURCE_TYPE = "faers";
// openFDA FAERS aggregate data is a US-government public record.
const LICENSE = "openFDA FAERS (U.S. FDA, public domain).";

// Split a free-text probe into (drug, event) when it carries an explicit separator. We
// only accept EXPLICIT separators ("->", ":", " for ", " and ") so we never guess an
// event out of thin air. Returns null when there's no separable pair.
function splitDrugEvent(text: string): { drug: string; event: string } | null {
  const separators = [" -> ", "->", " for ", ": ", ":", " and "];
  for (const sep of separators) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx + sep.length < text.length) {
      const drug = text.slice(0, idx).trim();
      const event = text.slice(idx + sep.length).trim();
      if (drug.length > 0 && event.length > 0) return { drug, event };
    }
  }
  return null;
}

// Resolve the (drug, event) pair from the context. Prefer an entity-provided drug + the
// query as the event; else split the query itself.
function resolvePair(context: DriverContext): { drug: string; event: string } | null {
  const entityDrug = context.entitySurface?.trim() || null;
  const query = context.query?.trim() || null;

  if (entityDrug && query && entityDrug.toLowerCase() !== query.toLowerCase()) {
    // Entity gave the drug; the query names the event of interest.
    return { drug: entityDrug, event: query };
  }
  if (query) {
    const split = splitDrugEvent(query);
    if (split) return split;
  }
  return null;
}

export const faersDriver: IngestDriver = {
  sourceType: SOURCE_TYPE,
  async fetch(context: DriverContext): Promise<CacheableSourceRecord[]> {
    const pair = resolvePair(context);
    if (!pair) return [];

    const assessment = await assessSafetySignal(pair.drug, pair.event).catch(() => null);
    if (!assessment) return [];

    // A stable external id: drug|event, lower-cased so the same pair caches once.
    const externalId = `${pair.drug}|${pair.event}`.toLowerCase();

    const signalWord = assessment.signal ? "SIGNAL" : "no signal";
    const rawText =
      `FAERS disproportionality for ${pair.drug} + ${pair.event}: ` +
      `${signalWord} (PRR ${assessment.prr.toFixed(2)}, ROR ${assessment.ror.toFixed(2)}, ` +
      `IC025 ${assessment.ic025.toFixed(2)}, Yates chi-square ${assessment.chiSquaredYates.toFixed(2)}, ` +
      `a=${assessment.a} reports of this drug-event pair out of n=${assessment.n}).`;

    const url =
      `https://api.fda.gov/drug/event.json?search=` +
      encodeURIComponent(
        `patient.drug.openfda.generic_name:"${pair.drug}" AND ` +
          `patient.reaction.reactionmeddrapt:"${pair.event}"`
      );

    return [
      {
        source_type: SOURCE_TYPE,
        external_id: externalId,
        title: `FAERS safety signal: ${pair.drug} / ${pair.event}`,
        raw_text: rawText,
        url,
        metadata: {
          license: LICENSE,
          sourceVersion: "openFDA drug/event",
          adverseEventCui: null,
          extra: {
            drug: pair.drug,
            event: pair.event,
            prr: assessment.prr,
            ror: assessment.ror,
            ic025: assessment.ic025,
            chiSquaredYates: assessment.chiSquaredYates,
            signal: assessment.signal,
            reports: assessment.a,
            corpus: assessment.n,
          },
        },
      },
    ];
  },
};
