// Open Targets ingest driver — wraps lib/bio/openTargets.targetDiseaseEvidence into a
// cacheable source record for a target–disease association.
//
// The association is keyed by a (target symbol, disease name) pair. The driver resolves
// the pair from the context: the entity surface as the target and the query as the
// disease (or an explicit "target -> disease" / "target in disease" split of the query).
// When it can't form a pair, or the pair has no scored association, it returns [] (honest
// empty) — never a fabricated score. NO LLM in the numeric path; the scores are exactly
// what the Open Targets Platform returned.

import { targetDiseaseEvidence } from "@/lib/bio/openTargets";
import type { TargetDiseaseEvidence } from "@/lib/bio/targets.schemas";
import type { CacheableSourceRecord, DriverContext, IngestDriver } from "./types";

const SOURCE_TYPE = "opentargets";
const LICENSE = "Open Targets Platform (CC0 1.0).";

// Split a probe into (target, disease) on an EXPLICIT separator only.
function splitTargetDisease(text: string): { target: string; disease: string } | null {
  const separators = [" -> ", "->", " in ", " for ", ": ", ":"];
  for (const sep of separators) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx + sep.length < text.length) {
      const target = text.slice(0, idx).trim();
      const disease = text.slice(idx + sep.length).trim();
      if (target.length > 0 && disease.length > 0) return { target, disease };
    }
  }
  return null;
}

function resolvePair(context: DriverContext): { target: string; disease: string } | null {
  const entityTarget = context.entitySurface?.trim() || null;
  const query = context.query?.trim() || null;

  if (entityTarget && query && entityTarget.toLowerCase() !== query.toLowerCase()) {
    // Entity named the target; the query names the disease.
    return { target: entityTarget, disease: query };
  }
  if (query) {
    const split = splitTargetDisease(query);
    if (split) return split;
  }
  return null;
}

function s(v: number | null): string {
  return v === null ? "no evidence" : v.toFixed(3);
}

// Deterministic summary of the association scores + a few known drugs.
function summarize(evidence: TargetDiseaseEvidence): string {
  const dt = evidence.datatypeScores;
  const drugs = evidence.knownDrugs
    .slice(0, 5)
    .map((d) => d.drugName ?? d.drugId ?? "unnamed")
    .filter((name) => name.length > 0);
  const drugText = drugs.length > 0 ? ` Known drugs: ${drugs.join(", ")}.` : "";
  return (
    `Open Targets association for ${evidence.target.approvedSymbol ?? evidence.target.querySymbol} — ` +
    `${evidence.disease.name ?? evidence.disease.queryName}: overall ${s(evidence.overallScore)} ` +
    `(genetic ${s(dt.genetic_association)}, known-drug ${s(dt.known_drug)}, ` +
    `literature ${s(dt.literature)}, animal-model ${s(dt.animal_model)}).${drugText}`
  );
}

export const openTargetsDriver: IngestDriver = {
  sourceType: SOURCE_TYPE,
  async fetch(context: DriverContext): Promise<CacheableSourceRecord[]> {
    const pair = resolvePair(context);
    if (!pair) return [];

    const evidence = await targetDiseaseEvidence(pair.target, pair.disease).catch(
      () => null
    );
    if (!evidence || !evidence.found) return [];

    const ensemblId = evidence.target.ensemblId ?? pair.target;
    const efoId = evidence.disease.efoId ?? pair.disease;
    const externalId = `${ensemblId}|${efoId}`;

    return [
      {
        source_type: SOURCE_TYPE,
        external_id: externalId,
        title:
          `Open Targets: ${evidence.target.approvedSymbol ?? pair.target} / ` +
          `${evidence.disease.name ?? pair.disease}`,
        raw_text: summarize(evidence),
        url:
          evidence.target.ensemblId && evidence.disease.efoId
            ? `https://platform.opentargets.org/evidence/${evidence.target.ensemblId}/${evidence.disease.efoId}`
            : "https://platform.opentargets.org/",
        metadata: {
          license: LICENSE,
          sourceVersion: "Open Targets GraphQL v4",
          extra: {
            ensemblId: evidence.target.ensemblId,
            efoId: evidence.disease.efoId,
            overallScore: evidence.overallScore,
            datatypeScores: evidence.datatypeScores,
            knownDrugCount: evidence.knownDrugs.length,
          },
        },
      },
    ];
  },
};
