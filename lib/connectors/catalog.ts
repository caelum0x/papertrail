import { z } from "zod";

// Provider catalog for the integrations hub. Each entry describes a connector
// provider: its display metadata, the capabilities it supports (sync/events),
// and — crucially — the Zod schema its `config` jsonb must satisfy. Route
// handlers validate a connector's config against `configSchemaFor(provider)`
// before persisting it, so an invalid Slack webhook or an S3 config missing its
// bucket is rejected at the boundary (never trust client input).
//
// This file is import-safe on the client (no `pg` / server-only imports) so the
// console can render the catalog grid and per-provider config forms from the same
// source of truth the server validates against.

// The set of supported providers. Kept as a const tuple so we can derive both a
// Zod enum and a TypeScript union from one declaration.
export const PROVIDERS = [
  "slack",
  "msteams",
  "email",
  "zotero",
  "orcid",
  "crossref",
  "s3",
  "generic-webhook",
] as const;

export type Provider = (typeof PROVIDERS)[number];

export const providerSchema = z.enum(PROVIDERS);

export function isProvider(value: unknown): value is Provider {
  return (
    typeof value === "string" && (PROVIDERS as readonly string[]).includes(value)
  );
}

// A single field in a provider's config form. Drives both client rendering and a
// human-readable description of the required shape. `secret` fields are redacted
// before being logged to connector_events.
export interface CatalogField {
  key: string;
  label: string;
  type: "text" | "url" | "email" | "password" | "select";
  required: boolean;
  placeholder?: string;
  help?: string;
  secret?: boolean;
  options?: ReadonlyArray<{ label: string; value: string }>;
}

// Capabilities gate which actions the UI offers for a provider.
export interface ProviderCapabilities {
  // Supports POST /connect (verifies/activates credentials).
  connect: boolean;
  // Supports POST /sync (pulls or pushes items).
  sync: boolean;
  // Emits/consumes events (inbound webhooks or outbound deliveries).
  events: boolean;
  // Supports POST /test (sends a lightweight test event).
  test: boolean;
}

export interface CatalogEntry {
  provider: Provider;
  name: string;
  category: "notifications" | "reference" | "identity" | "storage" | "custom";
  description: string;
  // Zod schema the connector's `config` must satisfy.
  configSchema: z.ZodTypeAny;
  fields: CatalogField[];
  capabilities: ProviderCapabilities;
  // Keys whose values must be redacted before being written to event payloads.
  secretKeys: string[];
}

// Reusable capability presets.
const NOTIFY_CAPS: ProviderCapabilities = {
  connect: true,
  sync: false,
  events: true,
  test: true,
};
const REFERENCE_CAPS: ProviderCapabilities = {
  connect: true,
  sync: true,
  events: true,
  test: true,
};
const IDENTITY_CAPS: ProviderCapabilities = {
  connect: true,
  sync: false,
  events: false,
  test: true,
};
const STORAGE_CAPS: ProviderCapabilities = {
  connect: true,
  sync: true,
  events: false,
  test: true,
};
const WEBHOOK_CAPS: ProviderCapabilities = {
  connect: true,
  sync: false,
  events: true,
  test: true,
};

const slackSchema = z.object({
  webhookUrl: z.string().url(),
  channel: z.string().trim().min(1).max(80).optional(),
});

const msteamsSchema = z.object({
  webhookUrl: z.string().url(),
});

const emailSchema = z.object({
  recipient: z.string().email(),
  fromName: z.string().trim().min(1).max(120).optional(),
});

const zoteroSchema = z.object({
  apiKey: z.string().trim().min(1).max(200),
  libraryType: z.enum(["user", "group"]),
  libraryId: z.string().trim().min(1).max(64),
  collectionKey: z.string().trim().min(1).max(64).optional(),
});

const orcidSchema = z.object({
  orcidId: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, "Invalid ORCID iD."),
  accessToken: z.string().trim().min(1).max(400).optional(),
});

const crossrefSchema = z.object({
  mailto: z.string().email(),
  plusToken: z.string().trim().min(1).max(200).optional(),
});

const s3Schema = z.object({
  bucket: z.string().trim().min(1).max(255),
  region: z.string().trim().min(1).max(64),
  prefix: z.string().trim().max(255).optional(),
  accessKeyId: z.string().trim().min(1).max(128),
  secretAccessKey: z.string().trim().min(1).max(256),
});

const genericWebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().trim().min(1).max(256).optional(),
  method: z.enum(["POST", "PUT"]).default("POST"),
});

// The catalog, keyed by provider for O(1) lookup.
export const CATALOG: Record<Provider, CatalogEntry> = {
  slack: {
    provider: "slack",
    name: "Slack",
    category: "notifications",
    description:
      "Post verification results and discrepancy alerts to a Slack channel via an incoming webhook.",
    configSchema: slackSchema,
    fields: [
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        type: "url",
        required: true,
        placeholder: "https://hooks.slack.com/services/…",
        secret: true,
      },
      {
        key: "channel",
        label: "Channel override",
        type: "text",
        required: false,
        placeholder: "#research-alerts",
      },
    ],
    capabilities: NOTIFY_CAPS,
    secretKeys: ["webhookUrl"],
  },
  msteams: {
    provider: "msteams",
    name: "Microsoft Teams",
    category: "notifications",
    description:
      "Send alerts to a Teams channel through an incoming webhook connector.",
    configSchema: msteamsSchema,
    fields: [
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        type: "url",
        required: true,
        placeholder: "https://outlook.office.com/webhook/…",
        secret: true,
      },
    ],
    capabilities: NOTIFY_CAPS,
    secretKeys: ["webhookUrl"],
  },
  email: {
    provider: "email",
    name: "Email",
    category: "notifications",
    description:
      "Email verification summaries and export-ready reports to a recipient.",
    configSchema: emailSchema,
    fields: [
      {
        key: "recipient",
        label: "Recipient email",
        type: "email",
        required: true,
        placeholder: "lab-lead@example.org",
      },
      {
        key: "fromName",
        label: "From name",
        type: "text",
        required: false,
        placeholder: "PaperTrail",
      },
    ],
    capabilities: NOTIFY_CAPS,
    secretKeys: [],
  },
  zotero: {
    provider: "zotero",
    name: "Zotero",
    category: "reference",
    description:
      "Sync references from a Zotero library or collection into PaperTrail.",
    configSchema: zoteroSchema,
    fields: [
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        required: true,
        secret: true,
      },
      {
        key: "libraryType",
        label: "Library type",
        type: "select",
        required: true,
        options: [
          { label: "User library", value: "user" },
          { label: "Group library", value: "group" },
        ],
      },
      {
        key: "libraryId",
        label: "Library ID",
        type: "text",
        required: true,
        placeholder: "123456",
      },
      {
        key: "collectionKey",
        label: "Collection key",
        type: "text",
        required: false,
        help: "Optional — restrict the sync to one collection.",
      },
    ],
    capabilities: REFERENCE_CAPS,
    secretKeys: ["apiKey"],
  },
  orcid: {
    provider: "orcid",
    name: "ORCID",
    category: "identity",
    description:
      "Link an ORCID iD to attribute verifications and pull the researcher's works.",
    configSchema: orcidSchema,
    fields: [
      {
        key: "orcidId",
        label: "ORCID iD",
        type: "text",
        required: true,
        placeholder: "0000-0002-1825-0097",
      },
      {
        key: "accessToken",
        label: "Access token",
        type: "password",
        required: false,
        secret: true,
        help: "Only needed for private-scope access.",
      },
    ],
    capabilities: IDENTITY_CAPS,
    secretKeys: ["accessToken"],
  },
  crossref: {
    provider: "crossref",
    name: "Crossref",
    category: "reference",
    description:
      "Resolve DOIs and enrich citations via the Crossref REST API (polite pool).",
    configSchema: crossrefSchema,
    fields: [
      {
        key: "mailto",
        label: "Polite-pool email",
        type: "email",
        required: true,
        placeholder: "you@example.org",
        help: "Sent as the mailto to join Crossref's polite pool.",
      },
      {
        key: "plusToken",
        label: "Metadata Plus token",
        type: "password",
        required: false,
        secret: true,
      },
    ],
    capabilities: REFERENCE_CAPS,
    secretKeys: ["plusToken"],
  },
  s3: {
    provider: "s3",
    name: "Amazon S3",
    category: "storage",
    description:
      "Archive source PDFs and export bundles to an S3 bucket for durable storage.",
    configSchema: s3Schema,
    fields: [
      {
        key: "bucket",
        label: "Bucket",
        type: "text",
        required: true,
        placeholder: "papertrail-archive",
      },
      {
        key: "region",
        label: "Region",
        type: "text",
        required: true,
        placeholder: "us-east-1",
      },
      {
        key: "prefix",
        label: "Key prefix",
        type: "text",
        required: false,
        placeholder: "exports/",
      },
      {
        key: "accessKeyId",
        label: "Access key ID",
        type: "text",
        required: true,
        secret: true,
      },
      {
        key: "secretAccessKey",
        label: "Secret access key",
        type: "password",
        required: true,
        secret: true,
      },
    ],
    capabilities: STORAGE_CAPS,
    secretKeys: ["accessKeyId", "secretAccessKey"],
  },
  "generic-webhook": {
    provider: "generic-webhook",
    name: "Generic webhook",
    category: "custom",
    description:
      "Deliver events to any HTTP endpoint with an optional HMAC signing secret.",
    configSchema: genericWebhookSchema,
    fields: [
      {
        key: "url",
        label: "Endpoint URL",
        type: "url",
        required: true,
        placeholder: "https://example.org/hooks/papertrail",
      },
      {
        key: "method",
        label: "HTTP method",
        type: "select",
        required: false,
        options: [
          { label: "POST", value: "POST" },
          { label: "PUT", value: "PUT" },
        ],
      },
      {
        key: "secret",
        label: "Signing secret",
        type: "password",
        required: false,
        secret: true,
        help: "Used to HMAC-sign the payload (X-PaperTrail-Signature).",
      },
    ],
    capabilities: WEBHOOK_CAPS,
    secretKeys: ["secret"],
  },
};

// The ordered list of catalog entries (for grid rendering).
export const CATALOG_LIST: CatalogEntry[] = PROVIDERS.map((p) => CATALOG[p]);

export function getCatalogEntry(provider: string): CatalogEntry | null {
  return isProvider(provider) ? CATALOG[provider] : null;
}

export function configSchemaFor(provider: Provider): z.ZodTypeAny {
  return CATALOG[provider].configSchema;
}

export function secretKeysFor(provider: string): string[] {
  const entry = getCatalogEntry(provider);
  return entry ? entry.secretKeys : [];
}

// Redacts a provider's secret config keys from an arbitrary object before it is
// logged to connector_events.payload. Returns a new object (never mutates input).
export function redactConfig(
  provider: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  const secrets = new Set(secretKeysFor(provider));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = secrets.has(k) ? "•••redacted•••" : v;
  }
  return out;
}
