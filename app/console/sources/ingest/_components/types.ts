// Client-side view types for the multi-source ingest console. These mirror the shapes the
// public routes return (see app/api/ingest/multi-source/route.ts and
// app/api/sources/quality-report/route.ts) so the page can render without importing
// server modules.

// One row per (source_type, external_id) the pipeline touched this run. `cached` is true
// when the row was reused from the cache (no live fetch), false when newly fetched.
export interface SourceIngestResult {
  source_type: string;
  external_id: string;
  cached: boolean;
  entitiesLinked: number;
}

export interface MultiSourceIngestResult {
  ingested: SourceIngestResult[];
  coverage: Record<string, number>;
  droppedUngrounded: number;
}

export interface SourceTypeCount {
  source_type: string;
  document_count: number;
}

export interface OntologyCount {
  ontology: string;
  entity_count: number;
}

export interface QualityReport {
  totalDocuments: number;
  perSourceType: SourceTypeCount[];
  entityCoverage: {
    documentsWithEntities: number;
    documentsWithoutEntities: number;
    coverageRatio: number;
    totalEntityLinks: number;
    distinctCanonicalEntities: number;
    perOntology: OntologyCount[];
  };
  entityTablePresent: boolean;
}

// The databases the pipeline can pull from. Presented as selectable chips; an empty
// selection lets the pipeline choose its own default set.
export interface SourceOption {
  id: string;
  label: string;
}

export const SOURCE_OPTIONS: readonly SourceOption[] = [
  { id: "pubmed", label: "PubMed" },
  { id: "clinicaltrials", label: "ClinicalTrials.gov" },
  { id: "faers", label: "OpenFDA / FAERS" },
  { id: "clinvar", label: "ClinVar" },
  { id: "chembl", label: "ChEMBL" },
  { id: "opentargets", label: "Open Targets" },
  { id: "pubtator", label: "PubTator" },
];
