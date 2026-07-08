// Shared integrations view types for the home, detail, and catalog pages.

export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "url" | "email" | "textarea";
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  kind: "post" | "manual";
  description: string;
  direction: "outbound" | "inbound";
  fields: ProviderField[];
}

export interface Integration {
  id: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
  status: "active" | "disabled";
  createdAt: string;
}

export interface IntegrationEvent {
  id: string;
  integrationId: string;
  direction: "outbound" | "inbound";
  event: string;
  payload: Record<string, unknown>;
  status: "success" | "failed" | "skipped";
  createdAt: string;
}

export interface TestResult {
  ok: boolean;
  detail: string;
  responseCode: number | null;
}

// Maps a provider field's declared type to a concrete <input type> value.
export function inputTypeFor(type: ProviderField["type"]): string {
  return type === "email" ? "email" : type === "url" ? "url" : "text";
}
