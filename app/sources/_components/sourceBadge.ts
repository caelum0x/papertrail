export interface SourceItem {
  id: string;
  source_type: string;
  external_id: string;
  title: string | null;
  url: string;
}

export interface SourceBadge {
  label: string;
  classes: string;
}

export function badgeFor(sourceType: string): SourceBadge {
  if (sourceType === "pubmed") {
    return { label: "PubMed", classes: "bg-blue-100 text-blue-800" };
  }
  if (sourceType === "clinicaltrials") {
    return { label: "ClinicalTrials.gov", classes: "bg-purple-100 text-purple-800" };
  }
  return { label: sourceType, classes: "bg-ink/10 text-ink/70" };
}

export function identifierLabel(sourceType: string, externalId: string): string {
  if (sourceType === "pubmed") return `PMID ${externalId}`;
  if (sourceType === "clinicaltrials") return externalId;
  return externalId;
}

export type TypeFilter = "all" | "pubmed" | "clinicaltrials";

export const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pubmed", label: "PubMed" },
  { value: "clinicaltrials", label: "ClinicalTrials.gov" },
];
