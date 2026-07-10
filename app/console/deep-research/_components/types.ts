// Client-facing types for the deep-research console. These mirror the JSON the
// /api/deep-research route returns (the source raw_text maps are stripped server
// side; the UI only ever sees grounded, offset-bearing citations). Kept narrow to
// exactly what the components render.

export interface DeepResearchSource {
  id: string;
  title: string | null;
  source_type: string;
}

export interface DeepResearchSubQuestion {
  question: string;
  rationale: string;
  search_query?: string;
}

export interface DeepResearchPlan {
  interpretation: string;
  sub_questions: DeepResearchSubQuestion[];
}

// The evidence pipeline report, narrowed to the fields the UI reads. `ok`
// discriminates a pooled report from an honest insufficient one.
export type DeepResearchReportBody =
  | {
      ok: true;
      pooled: {
        k: number;
        measure: string;
        random: {
          point: number;
          ciLower: number;
          ciUpper: number;
          reductionPercent: number;
          significant: boolean;
        };
        heterogeneity: { iSquared: number };
      };
      certainty: { certainty: string };
      verdict: { verdict: string; rationale: string };
      rationale: string;
    }
  | {
      ok: false;
      reason: string;
      usableStudies: number;
    };

export interface DeepResearchUsedSource {
  id: string;
  title: string | null;
  source_type: string;
}

export interface DeepResearchEvidence {
  sub_question: DeepResearchSubQuestion;
  result: {
    usedSources: DeepResearchUsedSource[];
    skipped: { label: string; reason: string }[];
    report: DeepResearchReportBody;
  };
}

export interface DeepResearchCitation {
  source_id: string;
  quote: string;
  grounding: { status: "exact" | "approximate"; start: number; end: number };
}

export interface DeepResearchClaim {
  text: string;
  citations: DeepResearchCitation[];
}

export interface DeepResearchSection {
  sub_question: string;
  claims: DeepResearchClaim[];
}

export interface DeepResearchResponse {
  question: string;
  plan: DeepResearchPlan;
  evidence: DeepResearchEvidence[];
  sources: DeepResearchSource[];
  summary: DeepResearchClaim[];
  sections: DeepResearchSection[];
  limitations: string;
  dropped_claims: number;
  supported_sub_questions: number;
}
