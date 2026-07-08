import type { EvidenceSourceType } from "@/lib/evidence/types";

// Human-readable labels for evidence source types, shared across the library and
// detail views so the vocabulary stays consistent.

export const SOURCE_TYPE_LABELS: Record<EvidenceSourceType, string> = {
  pubmed: "PubMed",
  clinicaltrials: "ClinicalTrials.gov",
  document: "Document",
  other: "Other",
};

export const SOURCE_TYPE_OPTIONS: { value: EvidenceSourceType; label: string }[] = [
  { value: "pubmed", label: SOURCE_TYPE_LABELS.pubmed },
  { value: "clinicaltrials", label: SOURCE_TYPE_LABELS.clinicaltrials },
  { value: "document", label: SOURCE_TYPE_LABELS.document },
  { value: "other", label: SOURCE_TYPE_LABELS.other },
];
