// BibTeX and RIS parsing + serialization for the Reference manager. Pure and
// deterministic (no Date.now / Math.random, no mutation of inputs). Parsers are
// forgiving: they extract what they can and stash unrecognized fields in `raw`
// so a round trip never silently drops data. Serializers reuse the shared
// citation exporters from @/lib/citationFormats where their shape fits.

import type { ParsedReference, Reference } from "@/lib/references/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseYear(value: string | undefined | null): number | null {
  if (!value) return null;
  const match = value.match(/\d{4}/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function splitBibAuthors(value: string): string[] {
  return value
    .split(/\s+and\s+/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

function emptyParsed(): ParsedReference {
  return {
    type: "article",
    title: null,
    authors: [],
    year: null,
    journal: null,
    doi: null,
    pmid: null,
    nctId: null,
    url: null,
    raw: {},
  };
}

// ---------------------------------------------------------------------------
// BibTeX parsing
// ---------------------------------------------------------------------------

// Strips one balanced layer of {braces} or "quotes" and collapses inner whitespace.
function cleanBibValue(raw: string): string {
  let v = raw.trim();
  if (v.endsWith(",")) v = v.slice(0, -1).trim();
  if (
    (v.startsWith("{") && v.endsWith("}")) ||
    (v.startsWith('"') && v.endsWith('"'))
  ) {
    v = v.slice(1, -1);
  }
  return v.replace(/\s+/g, " ").replace(/[{}]/g, "").trim();
}

// Splits a BibTeX entry body into field=value pairs, respecting brace nesting so
// commas inside {..} don't split a value prematurely.
function splitBibFields(body: string): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const ch of body) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) parts.push(current);

  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = cleanBibValue(part.slice(eq + 1));
    if (key.length > 0) fields.push([key, value]);
  }
  return fields;
}

// Parses a BibTeX document into references. Each @type{key, ...} block becomes one
// reference. Recognized fields map to structured columns; all fields (plus the
// cite key and entry type) are preserved in `raw`.
export function parseBibTeX(text: string): ParsedReference[] {
  const results: ParsedReference[] = [];
  const entryRe = /@(\w+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = entryRe.exec(text)) !== null) {
    const entryType = match[1].toLowerCase();
    if (entryType === "comment" || entryType === "preamble" || entryType === "string") {
      continue;
    }
    // Walk from the opening brace to its matching close.
    const start = entryRe.lastIndex;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    const inner = text.slice(start, i - 1);
    entryRe.lastIndex = i;

    const commaIdx = inner.indexOf(",");
    const citeKey = commaIdx === -1 ? inner.trim() : inner.slice(0, commaIdx).trim();
    const body = commaIdx === -1 ? "" : inner.slice(commaIdx + 1);
    const fields = splitBibFields(body);

    const ref = emptyParsed();
    ref.type = entryType || "article";
    const raw: Record<string, unknown> = { entryType, citeKey };

    for (const [key, value] of fields) {
      raw[key] = value;
      switch (key) {
        case "title":
          ref.title = value || null;
          break;
        case "author":
          ref.authors = splitBibAuthors(value);
          break;
        case "year":
        case "date":
          ref.year = ref.year ?? parseYear(value);
          break;
        case "journal":
        case "journaltitle":
        case "booktitle":
          ref.journal = ref.journal ?? (value || null);
          break;
        case "doi":
          ref.doi = value || null;
          break;
        case "pmid":
          ref.pmid = value || null;
          break;
        case "url":
          ref.url = ref.url ?? (value || null);
          break;
        case "note":
        case "howpublished":
          if (/NCT\d+/i.test(value)) {
            const nct = value.match(/NCT\d+/i);
            if (nct) ref.nctId = ref.nctId ?? nct[0].toUpperCase();
          }
          break;
        default:
          break;
      }
    }
    ref.raw = raw;
    results.push(ref);
  }
  return results;
}

// ---------------------------------------------------------------------------
// RIS parsing
// ---------------------------------------------------------------------------

// Parses an RIS document into references. Records are delimited by `ER  -`. Common
// tags map to structured columns; every tag's values are also kept in `raw`.
export function parseRIS(text: string): ParsedReference[] {
  const results: ParsedReference[] = [];
  const lines = text.split(/\r?\n/);

  let current: ParsedReference | null = null;
  let raw: Record<string, string[]> = {};
  const tagRe = /^([A-Z0-9]{2})\s{2}-\s?(.*)$/;

  const finalize = () => {
    if (current) {
      current.raw = raw;
      results.push(current);
    }
    current = null;
    raw = {};
  };

  for (const line of lines) {
    const m = line.match(tagRe);
    if (!m) continue;
    const tag = m[1];
    const value = m[2].trim();

    if (tag === "TY") {
      finalize();
      current = emptyParsed();
      current.type = value.toLowerCase() || "article";
      raw = { TY: [value] };
      continue;
    }
    if (!current) {
      // A stray tag before any TY — start a record implicitly.
      current = emptyParsed();
      raw = {};
    }
    if (tag === "ER") {
      finalize();
      continue;
    }

    (raw[tag] ??= []).push(value);

    switch (tag) {
      case "TI":
      case "T1":
        current.title = current.title ?? (value || null);
        break;
      case "AU":
      case "A1":
        if (value) current.authors = [...current.authors, value];
        break;
      case "PY":
      case "Y1":
        current.year = current.year ?? parseYear(value);
        break;
      case "JO":
      case "JF":
      case "T2":
        current.journal = current.journal ?? (value || null);
        break;
      case "DO":
        current.doi = current.doi ?? (value || null);
        break;
      case "UR":
        current.url = current.url ?? (value || null);
        break;
      case "AN":
      case "ID":
        if (/^\d+$/.test(value)) current.pmid = current.pmid ?? value;
        if (/NCT\d+/i.test(value)) {
          const nct = value.match(/NCT\d+/i);
          if (nct) current.nctId = current.nctId ?? nct[0].toUpperCase();
        }
        break;
      default:
        break;
    }
  }
  finalize();
  return results;
}

// Dispatch a parse by format.
export function parseReferences(
  format: "bibtex" | "ris",
  text: string
): ParsedReference[] {
  return format === "ris" ? parseRIS(text) : parseBibTeX(text);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function escapeBibTeX(value: string): string {
  return value.replace(/([{}%&$#_])/g, "\\$1");
}

function citeKeyFor(ref: Reference): string {
  const rawKey = (ref.raw as { citeKey?: unknown }).citeKey;
  if (typeof rawKey === "string" && rawKey.trim().length > 0) {
    return rawKey.trim().replace(/[^A-Za-z0-9_]/g, "");
  }
  const id = ref.pmid ?? ref.nctId;
  if (id && id.trim().length > 0) {
    return `ref_${id.replace(/[^A-Za-z0-9]/g, "")}`;
  }
  const base =
    (ref.authors[0]?.split(/[\s,]+/)[0] ?? "ref").toLowerCase() +
    (ref.year ? String(ref.year) : "");
  const slug = base.replace(/[^a-z0-9]/g, "");
  return slug.length > 0 ? slug : `ref_${ref.id.slice(0, 8)}`;
}

// Serialize a single reference to a BibTeX entry.
export function referenceToBibTeX(ref: Reference): string {
  const key = citeKeyFor(ref);
  const entryType = ref.type && /^[a-z]+$/i.test(ref.type) ? ref.type.toLowerCase() : "misc";
  const fields: string[] = [];

  if (ref.title) fields.push(`  title = {${escapeBibTeX(ref.title)}}`);
  if (ref.authors.length > 0) {
    fields.push(`  author = {${ref.authors.map(escapeBibTeX).join(" and ")}}`);
  }
  if (ref.year) fields.push(`  year = {${ref.year}}`);
  if (ref.journal) fields.push(`  journal = {${escapeBibTeX(ref.journal)}}`);
  if (ref.doi) fields.push(`  doi = {${escapeBibTeX(ref.doi)}}`);
  if (ref.url) fields.push(`  url = {${escapeBibTeX(ref.url)}}`);

  const notes: string[] = [];
  if (ref.pmid) notes.push(`PMID: ${ref.pmid}`);
  if (ref.nctId) notes.push(ref.nctId);
  if (notes.length > 0) fields.push(`  note = {${escapeBibTeX(notes.join("; "))}}`);

  return `@${entryType}{${key},\n${fields.join(",\n")}\n}`;
}

// RIS type code for a reference type (best-effort mapping).
function risType(type: string): string {
  const t = type.toLowerCase();
  if (t === "book") return "BOOK";
  if (t === "inproceedings" || t === "conference") return "CONF";
  if (t === "techreport" || t === "report") return "RPRT";
  if (t === "thesis" || t === "phdthesis") return "THES";
  if (t === "dataset") return "DATA";
  if (t === "webpage" || t === "misc") return "ELEC";
  return "JOUR";
}

// Serialize a single reference to an RIS record.
export function referenceToRIS(ref: Reference): string {
  const lines: string[] = [`TY  - ${risType(ref.type)}`];
  for (const author of ref.authors) lines.push(`AU  - ${author}`);
  if (ref.title) lines.push(`TI  - ${ref.title}`);
  if (ref.journal) lines.push(`JO  - ${ref.journal}`);
  if (ref.year) lines.push(`PY  - ${ref.year}`);
  if (ref.doi) lines.push(`DO  - ${ref.doi}`);
  if (ref.url) lines.push(`UR  - ${ref.url}`);
  if (ref.pmid) lines.push(`AN  - ${ref.pmid}`);
  if (ref.nctId) lines.push(`ID  - ${ref.nctId}`);
  lines.push("ER  - ");
  return lines.join("\n");
}

// Serialize a whole library to a BibTeX / RIS document.
export function serializeBibTeX(refs: Reference[]): string {
  return refs.map(referenceToBibTeX).join("\n\n") + (refs.length > 0 ? "\n" : "");
}

export function serializeRIS(refs: Reference[]): string {
  return refs.map(referenceToRIS).join("\n\n") + (refs.length > 0 ? "\n" : "");
}

// CSV cell escaping per RFC 4180 (wrap in quotes if it contains comma/quote/newline).
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_COLUMNS: ReadonlyArray<{ header: string; get: (r: Reference) => string }> = [
  { header: "type", get: (r) => r.type },
  { header: "title", get: (r) => r.title ?? "" },
  { header: "authors", get: (r) => r.authors.join("; ") },
  { header: "year", get: (r) => (r.year ? String(r.year) : "") },
  { header: "journal", get: (r) => r.journal ?? "" },
  { header: "doi", get: (r) => r.doi ?? "" },
  { header: "pmid", get: (r) => r.pmid ?? "" },
  { header: "nct_id", get: (r) => r.nctId ?? "" },
  { header: "url", get: (r) => r.url ?? "" },
];

export function serializeCSV(refs: Reference[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(",");
  const rows = refs.map((r) =>
    CSV_COLUMNS.map((c) => csvCell(c.get(r))).join(",")
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}

export interface SerializedDocument {
  body: string;
  contentType: string;
  extension: string;
}

// Serialize a library for export in the requested format.
export function serializeReferences(
  format: "bibtex" | "ris" | "csv",
  refs: Reference[]
): SerializedDocument {
  if (format === "ris") {
    return { body: serializeRIS(refs), contentType: "application/x-research-info-systems", extension: "ris" };
  }
  if (format === "csv") {
    return { body: serializeCSV(refs), contentType: "text/csv", extension: "csv" };
  }
  return { body: serializeBibTeX(refs), contentType: "application/x-bibtex", extension: "bib" };
}
