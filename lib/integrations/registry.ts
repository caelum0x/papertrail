import { z, type ZodType } from "zod";

// Provider registry for the Integrations module. Each provider declares a Zod
// schema for its config so we never trust raw JSON from the client, plus enough
// metadata for the console catalog to render an honest description and form.
//
// Honesty is a hard requirement here: we do NOT pretend to integrate with a
// system we can't actually reach. Providers fall into two buckets:
//   - "post" providers (slack, generic-webhook, email) make a real outbound
//     call at test time IF, and only if, they are configured with a reachable
//     endpoint. Email posts only when SMTP/relay env is configured, otherwise it
//     honestly reports "not configured" rather than faking a send.
//   - "manual" providers (zotero, csv-import) have no hard-required external
//     call; their "test" validates configuration and confirms readiness.

export type ProviderId =
  | "slack"
  | "email"
  | "zotero"
  | "generic-webhook"
  | "csv-import";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "slack",
  "email",
  "zotero",
  "generic-webhook",
  "csv-import",
];

// How a provider behaves when tested. "post" attempts a real HTTP call;
// "manual" validates config only (no external dependency).
export type ProviderKind = "post" | "manual";

// A single configurable field, used by the console to render a form without
// hard-coding provider knowledge in the UI.
export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "url" | "email" | "textarea";
  required: boolean;
  // True for fields that hold secrets — masked in list/detail responses.
  secret?: boolean;
  placeholder?: string;
  help?: string;
}

export interface ProviderDef {
  id: ProviderId;
  name: string;
  kind: ProviderKind;
  description: string;
  // Direction(s) this connector primarily operates in — informational.
  direction: "outbound" | "inbound";
  fields: ProviderField[];
  // Validates the config object for this provider. Never trust raw client JSON.
  configSchema: ZodType;
}

// --- Config schemas -------------------------------------------------------

const slackConfig = z.object({
  webhookUrl: z
    .string()
    .url("A valid Slack incoming-webhook URL is required.")
    .max(2048),
  channel: z.string().max(120).optional(),
});

const emailConfig = z.object({
  to: z.string().email("A valid recipient email is required.").max(320),
  subjectPrefix: z.string().max(120).optional(),
});

const zoteroConfig = z.object({
  apiKey: z.string().min(1, "A Zotero API key is required.").max(200),
  libraryId: z.string().min(1, "A Zotero library id is required.").max(64),
  collectionKey: z.string().max(64).optional(),
});

const genericWebhookConfig = z.object({
  url: z.string().url("A valid endpoint URL is required.").max(2048),
  secret: z.string().max(200).optional(),
});

const csvImportConfig = z.object({
  // Which entity CSV rows map to. Kept explicit so import is unambiguous.
  target: z.enum(["claims", "sources"]),
  hasHeaderRow: z.boolean().optional(),
  delimiter: z.string().max(4).optional(),
});

// --- Registry -------------------------------------------------------------

const REGISTRY: Record<ProviderId, ProviderDef> = {
  slack: {
    id: "slack",
    name: "Slack",
    kind: "post",
    direction: "outbound",
    description:
      "Post verification results and flags to a Slack channel via an incoming webhook.",
    fields: [
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        type: "url",
        required: true,
        secret: true,
        placeholder: "https://hooks.slack.com/services/…",
        help: "Create an incoming webhook in your Slack workspace and paste its URL.",
      },
      {
        key: "channel",
        label: "Channel (optional)",
        type: "text",
        required: false,
        placeholder: "#research",
      },
    ],
    configSchema: slackConfig,
  },
  email: {
    id: "email",
    name: "Email",
    kind: "post",
    direction: "outbound",
    description:
      "Email a recipient when a verification is flagged. Sends only if an email relay is configured on the server.",
    fields: [
      {
        key: "to",
        label: "Recipient email",
        type: "email",
        required: true,
        placeholder: "alerts@lab.example.edu",
      },
      {
        key: "subjectPrefix",
        label: "Subject prefix (optional)",
        type: "text",
        required: false,
        placeholder: "[PaperTrail]",
      },
    ],
    configSchema: emailConfig,
  },
  zotero: {
    id: "zotero",
    name: "Zotero",
    kind: "manual",
    direction: "outbound",
    description:
      "Configure a Zotero library so verified sources can be exported to a collection. Validates credentials only — no data leaves without an explicit export.",
    fields: [
      {
        key: "apiKey",
        label: "Zotero API key",
        type: "text",
        required: true,
        secret: true,
        placeholder: "P9NiFoyLeZu2bZNvvuQPDWsd",
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
        label: "Collection key (optional)",
        type: "text",
        required: false,
      },
    ],
    configSchema: zoteroConfig,
  },
  "generic-webhook": {
    id: "generic-webhook",
    name: "Generic webhook",
    kind: "post",
    direction: "outbound",
    description:
      "POST integration events as JSON to any HTTPS endpoint you control.",
    fields: [
      {
        key: "url",
        label: "Endpoint URL",
        type: "url",
        required: true,
        placeholder: "https://example.com/hooks/papertrail",
      },
      {
        key: "secret",
        label: "Shared secret (optional)",
        type: "text",
        required: false,
        secret: true,
        help: "Sent as an X-PaperTrail-Secret header so your receiver can verify the source.",
      },
    ],
    configSchema: genericWebhookConfig,
  },
  "csv-import": {
    id: "csv-import",
    name: "CSV import",
    kind: "manual",
    direction: "inbound",
    description:
      "Define how uploaded CSV rows map to claims or sources. Inbound connector — validates the mapping; rows are imported on upload.",
    fields: [
      {
        key: "target",
        label: "Import into",
        type: "text",
        required: true,
        placeholder: "claims",
        help: "Either 'claims' or 'sources'.",
      },
      {
        key: "delimiter",
        label: "Delimiter (optional)",
        type: "text",
        required: false,
        placeholder: ",",
      },
    ],
    configSchema: csvImportConfig,
  },
};

// The public catalog (no schemas — those don't serialize). Safe to return over
// the wire so the console can render the "available integrations" grid.
export interface ProviderCatalogEntry {
  id: ProviderId;
  name: string;
  kind: ProviderKind;
  description: string;
  direction: "outbound" | "inbound";
  fields: ProviderField[];
}

export function listProviders(): ProviderCatalogEntry[] {
  return PROVIDER_IDS.map((id) => {
    const def = REGISTRY[id];
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      description: def.description,
      direction: def.direction,
      fields: def.fields,
    };
  });
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.includes(value as ProviderId);
}

export function getProvider(id: string): ProviderDef | null {
  return isProviderId(id) ? REGISTRY[id] : null;
}

// Validate an untrusted config object against the provider's schema. Returns
// either the parsed config or a first human-readable error message.
export function validateConfig(
  provider: string,
  raw: unknown
):
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string } {
  const def = getProvider(provider);
  if (!def) {
    return { ok: false, error: `Unknown provider "${provider}".` };
  }
  const parsed = def.configSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid configuration.",
    };
  }
  return { ok: true, config: parsed.data as Record<string, unknown> };
}

// Mask secret fields in a config before it leaves the server. Returns a new
// object (never mutates) with secret values replaced by a short hint.
export function redactConfig(
  provider: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  const def = getProvider(provider);
  if (!def) return { ...config };
  const secretKeys = new Set(
    def.fields.filter((f) => f.secret).map((f) => f.key)
  );
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (secretKeys.has(key) && typeof value === "string" && value.length > 0) {
      out[key] = maskSecret(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Turns "hooks.slack.com/xyzsecret" into "…cret" style hint. Never reveals
// enough to reconstruct the secret.
function maskSecret(value: string): string {
  const tail = value.slice(-4);
  return `••••${tail}`;
}
