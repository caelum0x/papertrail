// Pure parser/normalizer for citation identifiers. Foundation for a future
// "pin to a specific source" input: a user pastes a raw identifier (a bare PMID,
// an NCT number, a DOI, or a doi.org URL) and we normalize it to a canonical id
// plus the canonical URL for that source type. Detection is best-effort and
// conservative — if nothing is confidently recognized we return null rather than
// guessing, matching PaperTrail's "honest no-match over a wrong match" stance.

export type SourceIdKind = "pmid" | "nct" | "doi";

export interface ParsedSourceId {
  kind: SourceIdKind;
  /** Normalized identifier: digits for PMID, uppercase NCT id, lowercase DOI. */
  id: string;
  /** Canonical URL for the source. */
  url: string;
}

// A DOI: "10." + registrant + "/" + suffix. The suffix runs to the first
// whitespace. See https://www.doi.org/doi_handbook/2_Numbering.html.
const DOI_CORE = /10\.\d{4,9}\/\S+/;
// NCT registry id: "NCT" + exactly 8 digits (ClinicalTrials.gov format).
const NCT_CORE = /NCT\d{8}/i;
// A run of digits, used to recognize a bare or "PMID:"-labeled PubMed id.
const PMID_CORE = /\d+/;

/**
 * Parse a raw citation identifier into a normalized id + canonical URL.
 * Recognizes (in priority order) DOI, NCT, then PMID. Returns null if the input
 * contains no recognizable identifier. Pure — does not mutate its input.
 */
export function parseSourceId(input: string): ParsedSourceId | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const doi = parseDoi(trimmed);
  if (doi) return doi;

  const nct = parseNct(trimmed);
  if (nct) return nct;

  const pmid = parsePmid(trimmed);
  if (pmid) return pmid;

  return null;
}

function parseDoi(input: string): ParsedSourceId | null {
  // Strip a "doi:" prefix or a doi.org URL prefix, then locate the DOI core.
  const stripped = input
    .replace(/^\s*doi:\s*/i, "")
    .replace(/^\s*https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const match = stripped.match(DOI_CORE);
  if (!match) return null;
  // Trim trailing punctuation that commonly follows a DOI in prose.
  const id = match[0].replace(/[.,;)\]]+$/, "").toLowerCase();
  return { kind: "doi", id, url: `https://doi.org/${id}` };
}

function parseNct(input: string): ParsedSourceId | null {
  const match = input.match(NCT_CORE);
  if (!match) return null;
  const id = match[0].toUpperCase();
  return { kind: "nct", id, url: `https://clinicaltrials.gov/study/${id}` };
}

function parsePmid(input: string): ParsedSourceId | null {
  // Accept a "PMID:"-labeled id anywhere, or an input that is purely digits.
  const labeled = input.match(/pmid:?\s*(\d+)/i);
  const bare = /^\d+$/.test(input) ? input.match(PMID_CORE) : null;
  const digits = labeled ? labeled[1] : bare ? bare[0] : null;
  if (!digits) return null;
  return {
    kind: "pmid",
    id: digits,
    url: `https://pubmed.ncbi.nlm.nih.gov/${digits}/`,
  };
}
