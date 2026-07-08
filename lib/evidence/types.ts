// Shared types for the Evidence library module. An evidence item is a curated
// reference (PubMed article, ClinicalTrials.gov trial, uploaded document, or
// other source) collected within an org and optionally scoped to a project.

export const EVIDENCE_SOURCE_TYPES = [
  "pubmed",
  "clinicaltrials",
  "document",
  "other",
] as const;

export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export interface EvidenceItem {
  id: string;
  org_id: string;
  project_id: string | null;
  source_type: EvidenceSourceType;
  external_id: string | null;
  title: string;
  url: string | null;
  notes: string | null;
  tags: string[];
  added_by: string | null;
  created_at: string;
}
