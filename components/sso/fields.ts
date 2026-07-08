import type { SsoProtocol } from "@/lib/sso/types";
import { SSO_FIELDS, type SsoConfigField } from "@/lib/sso/config";

// Client-facing view of the per-protocol SSO config field metadata. Re-exported
// from the server-side registry so the connection form and detail panels render
// exactly the fields the API validates against — one source of truth.

export type { SsoConfigField };

export const PROTOCOL_LABELS: Record<SsoProtocol, string> = {
  saml: "SAML 2.0",
  oidc: "OpenID Connect",
};

export const PROTOCOL_OPTIONS: { value: SsoProtocol; label: string }[] = [
  { value: "saml", label: PROTOCOL_LABELS.saml },
  { value: "oidc", label: PROTOCOL_LABELS.oidc },
];

export function fieldsForProtocol(protocol: SsoProtocol): SsoConfigField[] {
  return SSO_FIELDS[protocol] ?? [];
}
