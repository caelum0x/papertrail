// ChEMBL ingest driver — wraps lib/bio/chembl.resolveMolecule + targetBioactivities into
// a cacheable source record for a drug/compound.
//
// The driver resolves a compound NAME from the context (entity surface preferred, else the
// query), resolves it to a ChEMBL id, and summarizes its measured bioactivities into one
// cacheable source record. When the name doesn't resolve, or ChEMBL is unavailable, it
// returns [] (honest empty) — never a fabricated potency. NO LLM; every value is exactly
// what ChEMBL returned (CC BY-SA 3.0 data).

import {
  resolveMolecule,
  targetBioactivities,
  CHEMBL_ATTRIBUTION,
} from "@/lib/bio/chembl";
import type { Bioactivity } from "@/lib/bio/chembl.schemas";
import type { CacheableSourceRecord, DriverContext, IngestDriver } from "./types";

const SOURCE_TYPE = "chembl";
// Cap how many measured activities we fold into the summary text.
const MAX_ACTIVITIES_IN_TEXT = 10;

// The compound name to resolve: the entity surface (when the entity is a chemical/drug),
// else the free-text query. Returns null when neither is present.
function resolveCompoundName(context: DriverContext): string | null {
  if (context.entityType === "chemical" && context.entitySurface) {
    return context.entitySurface.trim();
  }
  const surface = context.entitySurface?.trim();
  if (surface && surface.length > 0) return surface;
  const query = context.query?.trim();
  if (query && query.length > 0) return query;
  return null;
}

// Deterministic, compact summary of the measured activities (most-potent first).
function summarizeActivities(activities: Bioactivity[]): string {
  const measurable = activities
    .filter((a) => a.standardType !== null && a.standardValue !== null && a.standardValue > 0)
    .sort((a, b) => (a.standardValue as number) - (b.standardValue as number))
    .slice(0, MAX_ACTIVITIES_IN_TEXT);
  if (measurable.length === 0) return "No comparable potency measurements reported.";
  return measurable
    .map(
      (a) =>
        `${a.targetName ?? a.targetChemblId ?? "unknown target"}: ` +
        `${a.standardType} ${a.standardValue} ${a.standardUnits ?? "nM"}`
    )
    .join("; ");
}

export const chemblDriver: IngestDriver = {
  sourceType: SOURCE_TYPE,
  async fetch(context: DriverContext): Promise<CacheableSourceRecord[]> {
    const name = resolveCompoundName(context);
    if (!name) return [];

    const molecule = await resolveMolecule(name).catch(() => null);
    if (!molecule || !molecule.chemblId) return [];

    const activities = await targetBioactivities(molecule.chemblId).catch(
      () => [] as Bioactivity[]
    );

    const phaseText =
      molecule.maxPhase !== null ? `max clinical phase ${molecule.maxPhase}` : "no reported phase";
    const rawText =
      `ChEMBL record for ${molecule.prefName ?? name} (${molecule.chemblId}): ${phaseText}. ` +
      `Measured bioactivities — ${summarizeActivities(activities)}`;

    return [
      {
        source_type: SOURCE_TYPE,
        external_id: molecule.chemblId,
        title: `ChEMBL: ${molecule.prefName ?? name} (${molecule.chemblId})`,
        raw_text: rawText,
        url: `https://www.ebi.ac.uk/chembl/compound_report_card/${molecule.chemblId}/`,
        metadata: {
          license: CHEMBL_ATTRIBUTION,
          sourceVersion: "ChEMBL REST",
          compoundId: molecule.chemblId,
          extra: {
            queryName: molecule.queryName,
            prefName: molecule.prefName,
            maxPhase: molecule.maxPhase,
            activityCount: activities.length,
          },
        },
      },
    ];
  },
};
