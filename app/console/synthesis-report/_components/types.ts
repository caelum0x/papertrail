// Client-side view of the synthesis-report API payload. Kept structurally in sync
// with lib/synthesisReport/schemas.ts (the server validates the real shape); the UI
// only needs the read side, so these are plain interfaces, not Zod schemas.

export type Certainty = "high" | "moderate" | "low" | "very_low";

export interface GroundingRefView {
  source_id: string;
  source_span: string;
  start: number;
  end: number;
  status: "exact" | "approximate";
}

export interface GroundedSentenceView {
  text: string;
  citations: string[];
  grounding: GroundingRefView | null;
}

export interface GroundedSectionView {
  id: string;
  heading: string;
  sentences: GroundedSentenceView[];
}

export interface EngineFactsView {
  poolable: boolean;
  measure: string | null;
  k: number | null;
  pooledPoint: number | null;
  pooledCiLower: number | null;
  pooledCiUpper: number | null;
  pooledReductionPercent: number | null;
  iSquared: number | null;
  certainty: Certainty | null;
  verdict: string | null;
  claimedReductionPercent: number | null;
  engineRationale: string;
}

export interface ReportSourceView {
  id: string;
  title: string | null;
  source_type: string;
}

export interface SynthesisReportView {
  topic: string;
  title: string;
  sections: GroundedSectionView[];
  facts: EngineFactsView;
  usedSources: ReportSourceView[];
  droppedSentenceCount: number;
  grounded: boolean;
}
