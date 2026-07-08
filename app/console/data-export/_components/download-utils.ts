import type { ExportFormat } from "@/lib/dataexport/schemas";

// Client-safe helper for building a fallback download filename extension. Kept
// separate from the server serializer so no server-only code leaks into the
// client bundle.
export function extensionForFormat(format: ExportFormat): string {
  return format === "csv" ? "csv" : "json";
}
