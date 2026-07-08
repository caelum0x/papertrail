import type { ExportFormat } from "@/lib/dataexport/schemas";

// Pure, deterministic serializers that turn org-scoped row data into a
// downloadable CSV or JSON document. No I/O, no mutation — given the same rows
// and columns they always produce the same string. The build layer owns
// fetching the rows.

export interface Column {
  // Key into each row object.
  key: string;
  // Human-readable header shown in the exported CSV.
  label: string;
}

export type CellValue = string | number | boolean | null | undefined;
export type Row = Record<string, CellValue>;

// Normalizes any cell into a display string. null/undefined become empty; other
// scalars are stringified so callers can pass numbers/booleans directly.
function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

// RFC-4180-ish CSV escaping: wrap in double quotes and double interior quotes
// when the field contains a comma, quote, CR, or LF.
function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Builds a CSV document. Rows are separated by CRLF per RFC 4180. An empty row
// set still yields the header line so downstream consumers get a valid document.
export function toCsv(rows: Row[], columns: Column[]): string {
  const header = columns.map((c) => escapeCsv(c.label)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escapeCsv(cellToString(row[c.key]))).join(",")
  );
  return [header, ...body].join("\r\n");
}

// Builds a JSON document: a stable array of row objects with only the exported
// columns, in the declared column order, pretty-printed for readability.
export function toJson(rows: Row[], columns: Column[]): string {
  const shaped = rows.map((row) => {
    const out: Record<string, CellValue> = {};
    for (const col of columns) {
      out[col.key] = row[col.key] ?? null;
    }
    return out;
  });
  return JSON.stringify(shaped, null, 2);
}

// MIME type + file extension for a given format, used when returning the document.
export function contentTypeFor(format: ExportFormat): string {
  return format === "csv"
    ? "text/csv; charset=utf-8"
    : "application/json; charset=utf-8";
}

export function extensionFor(format: ExportFormat): string {
  return format === "csv" ? "csv" : "json";
}

// Serializes rows in the requested format. Centralizes the format switch so the
// build/route layers never branch on format themselves.
export function serialize(
  format: ExportFormat,
  rows: Row[],
  columns: Column[]
): string {
  if (format === "csv") {
    return toCsv(rows, columns);
  }
  return toJson(rows, columns);
}
