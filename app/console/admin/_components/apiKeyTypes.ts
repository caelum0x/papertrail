// Shared types for the API keys admin page.

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string | null;
  createdByName: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

export interface ApiKeyCreated extends ApiKeySummary {
  key: string;
}
