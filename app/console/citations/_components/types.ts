import type { CitationClassifyOutcome } from "@/lib/citations/schemas";

// The API returns the discriminated engine outcome inside the standard envelope's
// `data`. Re-exported here so the page and its components share one source of truth.
export type CitationsClassifyResponse = CitationClassifyOutcome;
