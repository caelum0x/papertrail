// Shared types for the systematic review & screening module. A review project
// poses a research question with inclusion criteria; candidate records are
// screened through title/abstract and full-text stages.

export type SrProjectStatus = "active" | "completed" | "archived";

export type SrSourceType = "pubmed" | "clinicaltrials" | "manual" | "other";

export type SrRecordStatus =
  | "pending"
  | "title_included"
  | "title_excluded"
  | "fulltext_included"
  | "fulltext_excluded";

export type ScreeningStage = "title_abstract" | "full_text";

export type ScreeningDecision = "include" | "exclude";

export interface SrProject {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  question: string;
  inclusionCriteria: string[];
  status: SrProjectStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// A project enriched with record counts, for the list and detail headers.
export interface SrProjectWithCounts extends SrProject {
  recordCount: number;
  pendingCount: number;
}

export interface SrRecord {
  id: string;
  orgId: string;
  srProjectId: string;
  sourceType: SrSourceType;
  externalId: string | null;
  title: string;
  abstract: string | null;
  status: SrRecordStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScreeningDecisionRecord {
  id: string;
  orgId: string;
  srRecordId: string;
  reviewerId: string | null;
  stage: ScreeningStage;
  decision: ScreeningDecision;
  reason: string | null;
  createdAt: string;
}

// PRISMA flow counts for the flow-diagram view.
export interface PrismaCounts {
  identified: number;
  duplicatesRemoved: number;
  titleScreened: number;
  titleExcluded: number;
  fullTextAssessed: number;
  fullTextExcluded: number;
  included: number;
  // Breakdown of full-text exclusions by reason (for the PRISMA exclusion box).
  fullTextExclusionReasons: { reason: string; count: number }[];
}
