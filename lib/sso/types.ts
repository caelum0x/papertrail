// Shared types for the SSO / SCIM / MFA module. Every entity is org-scoped.
// These are the JSON shapes returned by the module's /api routes and consumed by
// the console settings pages. Secrets (SSO certs/client secrets, SCIM tokens,
// MFA secrets) are never present in these outward-facing shapes — see the
// repository's masking + the API layer.

// Supported SSO protocols.
export type SsoProtocol = "saml" | "oidc";

// Lifecycle of an SSO connection. A connection can only move to "active" once
// its domain is verified.
export type SsoStatus = "draft" | "active" | "disabled";

// An SSO connection as shown in listings and detail views. `config` is redacted
// (secret fields masked) for all API responses.
export interface SsoConnection {
  id: string;
  protocol: SsoProtocol;
  name: string;
  config: Record<string, unknown>;
  domain: string | null;
  verified: boolean;
  status: SsoStatus;
  createdAt: string;
}

// Result of POST /api/sso-connections/[id]/verify-domain. When ok is false the
// admin must place `token` as a DNS TXT record on the domain (returned so the UI
// can show the exact record to add) and retry.
export interface DomainVerifyResult {
  verified: boolean;
  domain: string | null;
  // The DNS TXT value the admin must publish (deterministic per connection).
  token: string;
  detail: string;
}

export type ScimStatus = "active" | "disabled";

// A SCIM directory as shown in listings/detail. The bearer token itself is
// never returned after creation; only its metadata.
export interface ScimDirectory {
  id: string;
  name: string;
  lastSyncAt: string | null;
  status: ScimStatus;
  createdAt: string;
}

// Returned exactly once from POST /api/scim-directories: the created directory
// plus the plaintext bearer token to hand to the IdP. The token is not
// recoverable afterwards.
export interface ScimDirectoryWithToken {
  directory: ScimDirectory;
  // Plaintext bearer token — shown once, never stored in plaintext.
  bearerToken: string;
}

// Supported MFA factor types.
export type MfaFactorType = "totp" | "recovery";

// A user's MFA factor as shown on the security page. The shared secret is never
// returned in this shape.
export interface MfaFactor {
  id: string;
  type: MfaFactorType;
  verified: boolean;
  createdAt: string;
}

// Returned from POST /api/mfa/enroll for a TOTP factor: the pending (unverified)
// factor plus the provisioning material the authenticator app needs. The secret
// is returned once here so the user can add it to their app, then verified via
// POST /api/mfa/verify.
export interface MfaEnrollment {
  factor: MfaFactor;
  // Base32 shared secret for manual entry.
  secret: string;
  // otpauth:// URI for QR-code rendering.
  otpauthUri: string;
}
