// Shared date formatters for the monitoring module UI. Kept out of the page
// components so list, detail, and overview sub-pages format consistently.

export function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleString();
}

export function formatDateTimeStrict(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}
