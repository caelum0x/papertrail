import { createHash } from "crypto";
import type { SsoProtocol } from "@/lib/sso/types";

// Provider-specific SSO config: which fields each protocol expects, which are
// secret (masked before leaving the server), and validation of the config
// envelope. Kept separate from the repository so both the API and the UI catalog
// can reason about the same field metadata.

export interface SsoConfigField {
  key: string;
  label: string;
  type: "text" | "url" | "textarea";
  required: boolean;
  secret: boolean;
  placeholder?: string;
  help?: string;
}

// Field definitions per protocol. SAML uses IdP metadata + a signing cert; OIDC
// uses issuer + client credentials.
const SAML_FIELDS: SsoConfigField[] = [
  {
    key: "idpEntityId",
    label: "IdP Entity ID",
    type: "text",
    required: true,
    secret: false,
    placeholder: "https://idp.example.com/metadata",
  },
  {
    key: "ssoUrl",
    label: "IdP SSO URL",
    type: "url",
    required: true,
    secret: false,
    placeholder: "https://idp.example.com/sso",
  },
  {
    key: "certificate",
    label: "X.509 signing certificate",
    type: "textarea",
    required: true,
    secret: true,
    help: "PEM-encoded certificate used to validate SAML assertions.",
  },
];

const OIDC_FIELDS: SsoConfigField[] = [
  {
    key: "issuer",
    label: "Issuer URL",
    type: "url",
    required: true,
    secret: false,
    placeholder: "https://accounts.example.com",
  },
  {
    key: "clientId",
    label: "Client ID",
    type: "text",
    required: true,
    secret: false,
  },
  {
    key: "clientSecret",
    label: "Client secret",
    type: "text",
    required: true,
    secret: true,
    help: "Stored encrypted-at-rest; masked in all responses.",
  },
];

export const SSO_FIELDS: Record<SsoProtocol, SsoConfigField[]> = {
  saml: SAML_FIELDS,
  oidc: OIDC_FIELDS,
};

const MASK = "••••••••";

export interface ValidateResult {
  ok: boolean;
  error: string;
  config: Record<string, unknown>;
}

// Validates a config object against a protocol's field metadata: required
// non-secret fields must be present and non-empty. Returns a trimmed copy.
export function validateSsoConfig(
  protocol: SsoProtocol,
  raw: Record<string, unknown>
): ValidateResult {
  const fields = SSO_FIELDS[protocol];
  if (!fields) {
    return { ok: false, error: "Unknown SSO protocol.", config: {} };
  }
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = raw[field.key];
    const str = typeof value === "string" ? value.trim() : "";
    if (field.required && str.length === 0) {
      // A masked value means "keep existing" — the caller (update path) handles
      // that by merging; on create it's genuinely missing.
      if (str !== MASK) {
        return {
          ok: false,
          error: `${field.label} is required.`,
          config: {},
        };
      }
    }
    if (str.length > 0) out[field.key] = str;
  }
  return { ok: true, error: "", config: out };
}

// Masks secret fields in a config for outward-facing responses. Non-secret
// fields pass through unchanged. A present secret becomes a fixed mask so the UI
// can show "configured" without leaking the value.
export function redactSsoConfig(
  protocol: SsoProtocol,
  config: Record<string, unknown>
): Record<string, unknown> {
  const fields = SSO_FIELDS[protocol];
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = config[field.key];
    if (value === undefined || value === null || value === "") continue;
    out[field.key] = field.secret ? MASK : value;
  }
  return out;
}

// Deterministic per-connection DNS TXT token an admin publishes to prove domain
// ownership. Derived from the connection id + domain so it's stable across
// retries without needing to store extra state.
export function domainVerificationToken(connectionId: string, domain: string): string {
  const digest = createHash("sha256")
    .update(`papertrail-sso:${connectionId}:${domain.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
  return `papertrail-verify=${digest}`;
}
