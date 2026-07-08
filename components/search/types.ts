// Shared types for global search, imported by both the API route and the
// console UI so the response shape stays in sync.

export const SEARCH_TYPES = [
  "claim",
  "document",
  "evidence",
  "verification",
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

// A single hit. `title` is the primary label, `snippet` an optional secondary
// line (e.g. a matched excerpt), `href` a console link to the entity.
export interface SearchResult {
  id: string;
  type: SearchType;
  title: string;
  snippet: string | null;
  href: string;
  createdAt: string | null;
}

// Results grouped by entity type, in a stable display order.
export interface SearchGroup {
  type: SearchType;
  label: string;
  results: SearchResult[];
}

export interface SearchResponse {
  query: string;
  total: number;
  groups: SearchGroup[];
}

export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  claim: "Claims",
  document: "Documents",
  evidence: "Evidence",
  verification: "Verifications",
};
