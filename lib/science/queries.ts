import type { Pool } from "pg";
import {
  normalizeArtifacts,
  type ConnectionStatus,
  type MessageRole,
  type ResearchArtifacts,
  type ScienceConnection,
  type ScienceConnectionConfig,
  type ScienceMessage,
  type ScienceSession,
  type SessionStatus,
} from "@/lib/science/types";

// Data-access layer for the Claude Science module. Every query is org-scoped:
// callers pass ctx.org.id so a tenant can never read or mutate another tenant's
// rows.

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

interface SessionRow {
  id: string;
  org_id: string;
  project_id: string | null;
  title: string;
  status: SessionStatus;
  created_by: string | null;
  created_at: Date | string;
}

function mapSession(row: SessionRow): ScienceSession {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
  };
}

const SESSION_COLS =
  "id, org_id, project_id, title, status, created_by, created_at";

export async function countSessions(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from science_sessions where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listSessions(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<ScienceSession[]> {
  const { rows } = await pool.query<SessionRow>(
    `select ${SESSION_COLS}
       from science_sessions
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(mapSession);
}

export async function getSession(
  pool: Pool,
  orgId: string,
  sessionId: string
): Promise<ScienceSession | null> {
  const { rows } = await pool.query<SessionRow>(
    `select ${SESSION_COLS}
       from science_sessions
      where org_id = $1 and id = $2`,
    [orgId, sessionId]
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

export async function createSession(
  pool: Pool,
  input: {
    orgId: string;
    projectId: string | null;
    title: string;
    createdBy: string;
  }
): Promise<ScienceSession> {
  const { rows } = await pool.query<SessionRow>(
    `insert into science_sessions (org_id, project_id, title, created_by)
     values ($1, $2, $3, $4)
     returning ${SESSION_COLS}`,
    [input.orgId, input.projectId, input.title, input.createdBy]
  );
  return mapSession(rows[0]);
}

// Confirms a project belongs to the org before a session is tied to it, so a
// tenant can't attach a session to another tenant's project id.
export async function projectExists(
  pool: Pool,
  orgId: string,
  projectId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `select exists(
       select 1 from projects where org_id = $1 and id = $2
     ) as exists`,
    [orgId, projectId]
  );
  return Boolean(rows[0]?.exists);
}

interface MessageRow {
  id: string;
  org_id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  artifacts: unknown;
  created_at: Date | string;
}

function mapMessage(row: MessageRow): ScienceMessage {
  return {
    id: row.id,
    orgId: row.org_id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    artifacts: normalizeArtifacts(row.artifacts),
    createdAt: toIso(row.created_at),
  };
}

const MESSAGE_COLS =
  "id, org_id, session_id, role, content, artifacts, created_at";

export async function listMessages(
  pool: Pool,
  orgId: string,
  sessionId: string
): Promise<ScienceMessage[]> {
  const { rows } = await pool.query<MessageRow>(
    `select ${MESSAGE_COLS}
       from science_messages
      where org_id = $1 and session_id = $2
      order by created_at asc`,
    [orgId, sessionId]
  );
  return rows.map(mapMessage);
}

export async function createMessage(
  pool: Pool,
  input: {
    orgId: string;
    sessionId: string;
    role: MessageRole;
    content: string;
    artifacts: ResearchArtifacts;
  }
): Promise<ScienceMessage> {
  const { rows } = await pool.query<MessageRow>(
    `insert into science_messages (org_id, session_id, role, content, artifacts)
     values ($1, $2, $3, $4, $5::jsonb)
     returning ${MESSAGE_COLS}`,
    [
      input.orgId,
      input.sessionId,
      input.role,
      input.content,
      JSON.stringify(input.artifacts),
    ]
  );
  return mapMessage(rows[0]);
}

interface ConnectionRow {
  id: string;
  org_id: string;
  name: string;
  config: unknown;
  status: ConnectionStatus;
  created_at: Date | string;
}

const EMPTY_CONFIG: ScienceConnectionConfig = {
  endpoint: null,
  workspaceId: null,
  notes: null,
};

function normalizeConfig(raw: unknown): ScienceConnectionConfig {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return {
      endpoint: typeof r.endpoint === "string" ? r.endpoint : null,
      workspaceId: typeof r.workspaceId === "string" ? r.workspaceId : null,
      notes: typeof r.notes === "string" ? r.notes : null,
    };
  }
  return EMPTY_CONFIG;
}

function mapConnection(row: ConnectionRow): ScienceConnection {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    config: normalizeConfig(row.config),
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

const CONNECTION_COLS = "id, org_id, name, config, status, created_at";

export async function listConnections(
  pool: Pool,
  orgId: string
): Promise<ScienceConnection[]> {
  const { rows } = await pool.query<ConnectionRow>(
    `select ${CONNECTION_COLS}
       from science_connections
      where org_id = $1
      order by created_at desc`,
    [orgId]
  );
  return rows.map(mapConnection);
}

export async function createConnection(
  pool: Pool,
  input: {
    orgId: string;
    name: string;
    config: ScienceConnectionConfig;
    status: ConnectionStatus;
  }
): Promise<ScienceConnection> {
  const { rows } = await pool.query<ConnectionRow>(
    `insert into science_connections (org_id, name, config, status)
     values ($1, $2, $3::jsonb, $4)
     returning ${CONNECTION_COLS}`,
    [input.orgId, input.name, JSON.stringify(input.config), input.status]
  );
  return mapConnection(rows[0]);
}
