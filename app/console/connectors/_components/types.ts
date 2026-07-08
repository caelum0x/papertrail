// Client-side view of a catalog entry as returned by GET /api/connectors/catalog
// (the server strips the non-serializable Zod schema; the field descriptors carry
// everything the config form needs). Mirrors the shape the route projects.

import type { CatalogField, ProviderCapabilities } from "@/lib/connectors/catalog";

export interface CatalogEntryView {
  provider: string;
  name: string;
  category: string;
  description: string;
  fields: CatalogField[];
  capabilities: ProviderCapabilities;
}

export type { CatalogField, ProviderCapabilities };
