import { z } from "zod";
import { providerSchema } from "./catalog";

// Zod schemas validating every mutating input to the connectors API at the route
// boundary (fail fast, never trust client data). The provider-specific `config`
// shape is validated separately against the catalog's per-provider schema, so
// here `config` is just "some object" — the route narrows it by provider.

export const CONNECTOR_STATUSES = [
  "disconnected",
  "connected",
  "error",
  "disabled",
] as const;

// Create: provider + name are required; config is validated against the catalog
// schema for `provider` in the route after this passes.
export const createConnectorSchema = z.object({
  provider: providerSchema,
  name: z.string().trim().min(1, "Name is required.").max(120),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type CreateConnectorInput = z.infer<typeof createConnectorSchema>;

// Update: name, config, and/or status. All optional; at least nothing is
// enforced structurally (an empty patch is a no-op that returns the row).
export const updateConnectorSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(CONNECTOR_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update.",
  });
export type UpdateConnectorInput = z.infer<typeof updateConnectorSchema>;

// List filters (query string). All optional.
export const listConnectorsQuerySchema = z.object({
  provider: providerSchema.optional(),
  status: z.enum(CONNECTOR_STATUSES).optional(),
});
export type ListConnectorsQuery = z.infer<typeof listConnectorsQuerySchema>;

// Sync history / events list filter by status/direction.
export const listSyncsQuerySchema = z.object({
  status: z.enum(["running", "success", "failed"]).optional(),
});
export type ListSyncsQuery = z.infer<typeof listSyncsQuerySchema>;

export const listEventsQuerySchema = z.object({
  direction: z.enum(["inbound", "outbound"]).optional(),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

// POST /test — an optional free-text event label the caller wants to emit.
export const testConnectorSchema = z.object({
  event: z.string().trim().min(1).max(120).default("test.ping"),
});
export type TestConnectorInput = z.infer<typeof testConnectorSchema>;
