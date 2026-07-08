import { z } from "zod";
import { PROVIDER_IDS } from "@/lib/integrations/registry";

// Zod schemas for the Integrations API boundary. The per-provider `config`
// object is validated separately against the provider's own schema (see
// validateConfig in the registry) — here we only validate the envelope.

const providerEnum = z.enum(
  PROVIDER_IDS as unknown as [string, ...string[]]
);

export const createIntegrationSchema = z.object({
  provider: providerEnum,
  name: z.string().trim().min(1, "A name is required.").max(120),
  // Provider-specific config; shape validated by the registry, not here.
  config: z.record(z.string(), z.unknown()).optional(),
});

export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;

export const updateIntegrationSchema = z
  .object({
    name: z.string().trim().min(1, "A name is required.").max(120).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined || v.status !== undefined || v.config !== undefined,
    { message: "Provide at least one field to update." }
  );

export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;
