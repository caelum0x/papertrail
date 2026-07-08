// Turns an array of row objects into an RFC-4180-ish CSV string a researcher can open
// in Excel/Sheets. Pure and deterministic: field order follows the caller-supplied
// `columns`, missing fields become empty strings, and any field containing a comma,
// double-quote, CR, or LF is wrapped in double quotes with interior quotes doubled.

function escapeField(value: string): string {
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function toCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  return escapeField(String(value));
}

/**
 * Build a CSV document from `rows`, emitting exactly the given `columns` (in order) as
 * both the header row and the value order for every data row. Rows are separated by CRLF
 * per RFC 4180. Empty `rows` still yields the header line.
 */
export function toCsv(rows: Record<string, string | number>[], columns: string[]): string {
  const header = columns.map((column) => escapeField(column)).join(",");
  const body = rows.map((row) => columns.map((column) => toCell(row[column])).join(","));
  return [header, ...body].join("\r\n");
}
