// Shared formatting helpers and constants for the API-usage console pages.

export const PAGE_SIZE = 20;

// Selectable lookback windows, in days, offered across the module.
export const RANGE_OPTIONS: ReadonlyArray<{ label: string; days: number }> = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

export const DEFAULT_RANGE_DAYS = 30;

export const METHOD_OPTIONS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// A short, human display for a key that may be unnamed / detached.
export function keyLabel(keyName: string | null, apiKeyId: string | null): string {
  if (keyName) return keyName;
  if (apiKeyId) return `${apiKeyId.slice(0, 8)}…`;
  return "Deleted / no key";
}

// Tailwind classes for a status-code pill by class of response.
export function statusColorClass(status: number): string {
  if (status >= 500) return "bg-red-50 text-red-700 border-red-200";
  if (status >= 400) return "bg-amber-50 text-amber-700 border-amber-200";
  if (status >= 300) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}
