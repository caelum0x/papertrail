// Shared formatting helpers and constants for the connectors console pages.

export const PAGE_SIZE = 20;

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

// Tailwind classes for a connector status pill.
export function connectorStatusClass(status: string): string {
  switch (status) {
    case "connected":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "error":
      return "bg-red-50 text-red-700 border-red-200";
    case "disabled":
      return "bg-ink/5 text-ink/50 border-ink/15";
    default: // disconnected
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

export function connectorStatusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled";
    default:
      return "Disconnected";
  }
}

// Tailwind classes for a sync-status pill.
export function syncStatusClass(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "failed":
      return "bg-red-50 text-red-700 border-red-200";
    default: // running
      return "bg-blue-50 text-blue-700 border-blue-200";
  }
}

// Tailwind classes for an event-direction pill.
export function directionClass(direction: string): string {
  return direction === "inbound"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-purple-50 text-purple-700 border-purple-200";
}

export function categoryLabel(category: string): string {
  switch (category) {
    case "notifications":
      return "Notifications";
    case "reference":
      return "Reference";
    case "identity":
      return "Identity";
    case "storage":
      return "Storage";
    default:
      return "Custom";
  }
}

// Short provider glyph used in cards/rows (kept to plain text so no icon dep).
export function providerGlyph(provider: string): string {
  return (provider[0] ?? "?").toUpperCase();
}
