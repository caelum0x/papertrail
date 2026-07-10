// Client-side mirror of the /api/paper-qa response shape. Kept in sync with
// lib/paperqa/ask.ts (PaperQaOutcome). Client components import from here so the
// page stays free of engine imports.

export type GroundingStatus = "exact" | "approximate";

export interface Grounding {
  status: GroundingStatus;
  start: number;
  end: number;
}

export interface GroundedEvidence {
  quote: string;
  relevance: string;
  supports: "answers" | "contradicts" | "context";
  located_text: string;
  grounding: Grounding;
}

export interface ReadSource {
  index: number;
  id: string;
  title: string | null;
  url: string;
  source_type: "pubmed" | "clinicaltrials";
  external_id: string;
  similarity: number;
  evidence: GroundedEvidence[];
}

export interface GroundedCitation {
  source_index: number;
  source_id: string;
  quote: string;
  grounding: Grounding;
}

export interface GroundedClaim {
  text: string;
  citations: GroundedCitation[];
}

export interface PaperQaAnswered {
  status: "answered";
  question: string;
  sources: ReadSource[];
  claims: GroundedClaim[];
  caveat: string;
  dropped_claims: number;
}

export interface PaperQaNoSupport {
  status: "no_support_found";
  question: string;
  message: string;
}

export type PaperQaResponse = PaperQaAnswered | PaperQaNoSupport;
