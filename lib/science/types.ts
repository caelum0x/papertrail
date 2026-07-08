import { z } from "zod";

// Domain types and validation schemas for the Claude Science module. Structured
// LLM output (research artifacts) is validated against a Zod schema before use,
// per the repo convention — never trust a raw JSON.parse of a model response.

export type SessionStatus = "active" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type ConnectionStatus = "disabled" | "enabled" | "error";

export interface ScienceSession {
  id: string;
  orgId: string;
  projectId: string | null;
  title: string;
  status: SessionStatus;
  createdBy: string | null;
  createdAt: string;
}

// A structured research suggestion the assistant may attach to a turn. Kept
// deliberately small and honest: literature queries + citations + next steps.
export interface ResearchArtifacts {
  literatureQueries: string[];
  citations: { title: string; source: string; note: string | null }[];
  nextSteps: string[];
}

export interface ScienceMessage {
  id: string;
  orgId: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  artifacts: ResearchArtifacts;
  createdAt: string;
}

export interface ScienceConnection {
  id: string;
  orgId: string;
  name: string;
  config: ScienceConnectionConfig;
  status: ConnectionStatus;
  createdAt: string;
}

// Non-secret connection metadata for the Claude Science workbench beta. The API
// secret never lives here — it is read from an env var by the connector.
export interface ScienceConnectionConfig {
  endpoint: string | null;
  workspaceId: string | null;
  notes: string | null;
}

export const SESSION_STATUSES: readonly SessionStatus[] = ["active", "archived"];

export const artifactsSchema = z.object({
  literatureQueries: z.array(z.string().trim().min(1)).max(10).default([]),
  citations: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        source: z.string().trim().min(1),
        note: z.string().trim().nullable().default(null),
      })
    )
    .max(20)
    .default([]),
  nextSteps: z.array(z.string().trim().min(1)).max(10).default([]),
});

export const assistantReplySchema = z.object({
  content: z.string().trim().min(1),
  artifacts: artifactsSchema,
});

export type AssistantReply = z.infer<typeof assistantReplySchema>;

export const createSessionSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  projectId: z.string().uuid("A valid project id is required.").optional().nullable(),
});

export const postMessageSchema = z.object({
  content: z.string().trim().min(1, "Message is required.").max(8000),
});

export const connectionConfigSchema = z.object({
  endpoint: z.string().trim().url("Must be a valid URL.").max(500).optional().nullable(),
  workspaceId: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const createConnectionSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  config: connectionConfigSchema.optional(),
  status: z.enum(["disabled", "enabled", "error"]).optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type PostMessageInput = z.infer<typeof postMessageSchema>;
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

const EMPTY_ARTIFACTS: ResearchArtifacts = {
  literatureQueries: [],
  citations: [],
  nextSteps: [],
};

// Coerces a jsonb `artifacts` blob from the DB into a safe ResearchArtifacts,
// falling back to an empty shape rather than throwing on legacy/partial rows.
export function normalizeArtifacts(raw: unknown): ResearchArtifacts {
  const parsed = artifactsSchema.safeParse(raw);
  if (!parsed.success) {
    return EMPTY_ARTIFACTS;
  }
  return parsed.data;
}
