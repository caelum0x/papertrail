// Client mirror of the science API shapes. Kept separate from lib/science/types
// so page bundles don't pull in zod. No server-only imports here.

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

export interface ScienceConnectionConfig {
  endpoint: string | null;
  workspaceId: string | null;
  notes: string | null;
}

export interface ScienceConnection {
  id: string;
  orgId: string;
  name: string;
  config: ScienceConnectionConfig;
  status: ConnectionStatus;
  createdAt: string;
}

// Shape returned by GET /api/science/sessions/[id].
export interface SessionDetail {
  session: ScienceSession;
  messages: ScienceMessage[];
  workbench: { configured: boolean; endpoint: string | null; reason: string | null };
}
