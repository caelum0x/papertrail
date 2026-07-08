// Deterministic parsing for the bulk import center. Turns raw uploaded text
// (CSV / BibTeX / RIS) into a uniform ParsedTable: an ordered list of column
// names plus rows of string cells. Downstream, the mapping step lets a user
// wire those columns onto a target table's fields.
//
// BibTeX/RIS parsing is delegated to the Reference manager's battle-tested
// parsers (@/lib/references/formats) and then flattened into the same row shape
// so the whole pipeline is format-agnostic after this point. Pure functions: no
// Date.now / Math.random, no mutation of inputs.

import { parseBibTeX, parseRIS } from "@/lib/references/formats";
import type { ImportFormat } from "@/lib/import/types";

// A parsed source table: stable column order + rows keyed by column name. Every
// cell is a string (empty string for missing) so mapping/preview never deal with
// undefined.
export interface ParsedTable {
  columns: string[];
  rows: Record<string, string>[];
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180, forgiving)
// ---------------------------------------------------------------------------

// Tokenizes CSV text into a matrix of string cells, honoring quoted fields with
// embedded commas, quotes ("") and newlines. Accepts \n and \r\n line endings.
export function parseCsvMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Swallow the CR; the following LF (if any) closes the row.
      if (text[i + 1] === "\n") {
        endRow();
        i += 2;
      } else {
        endRow();
        i += 1;
      }
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush a trailing field/row unless the whole document ended on a clean newline
  // (in which case field is "" and row is empty).
  if (field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
}

// Parses a CSV document with a header row into a ParsedTable. Blank trailing rows
// are dropped; ragged rows are padded/truncated to the header width. Duplicate
// headers are disambiguated so the mapping selectors stay unambiguous.
export function parseCsv(text: string): ParsedTable {
  const matrix = parseCsvMatrix(text).filter(
    (r) => !(r.length === 1 && r[0].trim() === "")
  );
  if (matrix.length === 0) {
    return { columns: [], rows: [] };
  }

  const seen = new Map<string, number>();
  const columns = matrix[0].map((raw, idx) => {
    const base = raw.trim() || `column_${idx + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  const rows = matrix.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    columns.forEach((col, idx) => {
      record[col] = (cells[idx] ?? "").trim();
    });
    return record;
  });

  return { columns, rows };
}

// ---------------------------------------------------------------------------
// BibTeX / RIS -> flat rows
// ---------------------------------------------------------------------------

// Canonical columns produced from a parsed reference. These are the keys a
// mapping can address for BibTeX/RIS imports (independent of the source file's
// idiosyncratic field names).
export const REFERENCE_COLUMNS: readonly string[] = [
  "type",
  "title",
  "authors",
  "year",
  "journal",
  "doi",
  "pmid",
  "nct_id",
  "url",
];

function flattenReference(ref: {
  type: string;
  title: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  pmid: string | null;
  nctId: string | null;
  url: string | null;
}): Record<string, string> {
  return {
    type: ref.type ?? "",
    title: ref.title ?? "",
    authors: ref.authors.join("; "),
    year: ref.year != null ? String(ref.year) : "",
    journal: ref.journal ?? "",
    doi: ref.doi ?? "",
    pmid: ref.pmid ?? "",
    nct_id: ref.nctId ?? "",
    url: ref.url ?? "",
  };
}

// Parses a BibTeX document into the uniform ParsedTable shape.
export function parseBibtexTable(text: string): ParsedTable {
  const refs = parseBibTeX(text);
  return {
    columns: [...REFERENCE_COLUMNS],
    rows: refs.map(flattenReference),
  };
}

// Parses an RIS document into the uniform ParsedTable shape.
export function parseRisTable(text: string): ParsedTable {
  const refs = parseRIS(text);
  return {
    columns: [...REFERENCE_COLUMNS],
    rows: refs.map(flattenReference),
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// Parse raw text by declared format into a uniform ParsedTable.
export function parseImport(format: ImportFormat, text: string): ParsedTable {
  switch (format) {
    case "csv":
      return parseCsv(text);
    case "bibtex":
      return parseBibtexTable(text);
    case "ris":
      return parseRisTable(text);
    default:
      return { columns: [], rows: [] };
  }
}

// A default best-effort mapping: for each target field key, pick a source column
// whose normalized name matches (exact, then contains). Used to pre-fill the
// MappingStep so common well-formed files import with zero manual wiring.
export function suggestMapping(
  targetFieldKeys: readonly string[],
  columns: readonly string[]
): Record<string, string> {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mapping: Record<string, string> = {};
  for (const field of targetFieldKeys) {
    const nf = normalize(field);
    const exact = columns.find((c) => normalize(c) === nf);
    if (exact) {
      mapping[field] = exact;
      continue;
    }
    const partial = columns.find(
      (c) => normalize(c).includes(nf) || nf.includes(normalize(c))
    );
    if (partial) {
      mapping[field] = partial;
    }
  }
  return mapping;
}
