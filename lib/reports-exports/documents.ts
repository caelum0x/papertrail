import type { ExportFormat } from "@/lib/reports-exports/schemas";

// Pure, deterministic serializers that turn org-scoped row data into a downloadable
// CSV or Markdown document. No I/O, no mutation — given the same rows and columns
// they always produce the same string. The route layer owns fetching the rows.

export interface Column {
  // Key into each row object.
  key: string;
  // Human-readable header shown in the exported document.
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

// RFC-4180-ish CSV escaping: wrap in double quotes and double interior quotes when
// the field contains a comma, quote, CR, or LF.
function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Builds a CSV document. Rows are separated by CRLF per RFC 4180. An empty row set
// still yields the header line so downstream consumers get a valid document.
export function toCsv(rows: Row[], columns: Column[]): string {
  const header = columns.map((c) => escapeCsv(c.label)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escapeCsv(cellToString(row[c.key]))).join(",")
  );
  return [header, ...body].join("\r\n");
}

// Escapes Markdown table-cell content: pipes are escaped and newlines collapsed to
// spaces so a multi-line value never breaks the single-row table structure.
function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// Builds a Markdown document: an H1 title, a generated-at line, and a GitHub-flavored
// table. An empty row set renders the header plus an explanatory note.
export function toMarkdown(
  rows: Row[],
  columns: Column[],
  title: string,
  generatedAt: Date
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`_Generated ${generatedAt.toISOString()} · ${rows.length} rows_`);
  lines.push("");

  const header = `| ${columns.map((c) => escapeMarkdownCell(c.label)).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  lines.push(header);
  lines.push(divider);

  if (rows.length === 0) {
    lines.push(`| ${columns.map(() => "").join(" | ")} |`);
    lines.push("");
    lines.push("_No rows matched this export._");
  } else {
    for (const row of rows) {
      const cells = columns.map((c) =>
        escapeMarkdownCell(cellToString(row[c.key]))
      );
      lines.push(`| ${cells.join(" | ")} |`);
    }
  }

  return lines.join("\n");
}

// MIME type + file extension for a given format, used when returning the document.
export function contentTypeFor(format: ExportFormat): string {
  return format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8";
}

export function extensionFor(format: ExportFormat): string {
  return format === "csv" ? "csv" : "md";
}

// Serializes rows in the requested format. Markdown needs a title + timestamp; CSV
// ignores them. Centralizes the format switch so routes never branch on format.
export function serialize(
  format: ExportFormat,
  rows: Row[],
  columns: Column[],
  title: string,
  generatedAt: Date
): string {
  if (format === "csv") {
    return toCsv(rows, columns);
  }
  return toMarkdown(rows, columns, title, generatedAt);
}
