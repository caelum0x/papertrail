// Citation exporters for a matched primary source. A researcher who confirms a
// claim against its source often wants to drop that source straight into a
// reference manager (BibTeX / RIS) or a manuscript (plain one-line citation).
// Pure and deterministic: no Date.now / Math.random, no mutation. Handles a null
// title ("Untitled source") and a missing external_id gracefully.

export interface CitationSource {
  title: string | null;
  url: string;
  source_type: string;
  external_id?: string;
}

const UNTITLED = "Untitled source";

/** Human label for the registry an id belongs to. */
function registryLabel(sourceType: string): string {
  return sourceType === "pubmed" ? "PubMed" : "ClinicalTrials.gov";
}

/** Label for the identifier kind carried by external_id. */
function idLabel(sourceType: string): string {
  return sourceType === "pubmed" ? "PMID" : "NCT";
}

/** True when the source is a clinical trial registry entry (vs. a journal article). */
function isTrial(sourceType: string): boolean {
  return sourceType === "clinicaltrials";
}

function safeTitle(title: string | null): string {
  const trimmed = (title ?? "").trim();
  return trimmed.length > 0 ? trimmed : UNTITLED;
}

/**
 * Stable-ish BibTeX cite key. Prefer the external_id (PMID digits or NCT id);
 * otherwise slugify the title. Never random — the same source always yields the
 * same key so re-exports diff cleanly.
 */
function citeKey(src: CitationSource): string {
  if (src.external_id && src.external_id.trim().length > 0) {
    const cleaned = src.external_id.trim().replace(/[^A-Za-z0-9]/g, "");
    if (cleaned.length > 0) return `papertrail_${cleaned}`;
  }
  const slug = safeTitle(src.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `papertrail_${slug.length > 0 ? slug : "untitled"}`;
}

/** Escape the small set of characters that are special in BibTeX field values. */
function escapeBibTeX(value: string): string {
  return value.replace(/([{}%&$#_])/g, "\\$1");
}

/**
 * A BibTeX entry for the source. PubMed sources become @article; trials become
 * @misc (with howpublished pointing at the registry). A note field carries the
 * PMID/NCT when known.
 */
export function toBibTeX(src: CitationSource): string {
  const key = citeKey(src);
  const title = escapeBibTeX(safeTitle(src.title));
  const entryType = isTrial(src.source_type) ? "misc" : "article";

  const fields: string[] = [];
  fields.push(`  title = {${title}}`);
  fields.push(`  url = {${escapeBibTeX(src.url)}}`);

  if (isTrial(src.source_type)) {
    fields.push(`  howpublished = {${escapeBibTeX(registryLabel(src.source_type))}}`);
  }

  if (src.external_id && src.external_id.trim().length > 0) {
    const note = `${idLabel(src.source_type)}: ${src.external_id.trim()}`;
    fields.push(`  note = {${escapeBibTeX(note)}}`);
  }

  return `@${entryType}{${key},\n${fields.join(",\n")}\n}`;
}

/**
 * An RIS record for the source. JOUR for journal articles, RPRT for trials.
 * Includes TI (title), UR (url), and ID (external id, when present).
 */
export function toRIS(src: CitationSource): string {
  const type = isTrial(src.source_type) ? "RPRT" : "JOUR";
  const lines: string[] = [];
  lines.push(`TY  - ${type}`);
  lines.push(`TI  - ${safeTitle(src.title)}`);
  lines.push(`UR  - ${src.url}`);
  if (src.external_id && src.external_id.trim().length > 0) {
    lines.push(`ID  - ${src.external_id.trim()}`);
  }
  lines.push("ER  - ");
  return lines.join("\n");
}

/**
 * A readable one-line citation, e.g.
 * `Some title (PubMed PMID: 12345678). https://…`
 * When no external_id is known the registry alone is shown.
 */
export function toPlainCitation(src: CitationSource): string {
  const title = safeTitle(src.title);
  const registry = registryLabel(src.source_type);
  const id =
    src.external_id && src.external_id.trim().length > 0
      ? `${registry} ${idLabel(src.source_type)}: ${src.external_id.trim()}`
      : registry;
  return `${title} (${id}). ${src.url}`;
}
