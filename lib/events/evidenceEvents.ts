import type { Pool } from "pg";
import { dispatchEvent } from "@/lib/webhooks/dispatch";
import { listActiveWebhooksForEvent } from "@/lib/webhooks/repository";
import type { DispatchResult } from "@/lib/webhooks/types";
import {
  emitEvidenceEventSchema,
  evidenceEventDataSchema,
  type EmitEvidenceEventInput,
  type EvidenceEventData,
  type EvidenceEventLogEntry,
  type EvidenceEventType,
} from "@/lib/events/evidenceEvents.schemas";

// Evidence-lifecycle webhook emitter.
//
// emitEvidenceEvent is the single entry point the evidence pipeline calls when a
// lifecycle event happens (verification completes, a dossier is built/published,
// a signal is detected). It:
//   1. Validates + SANITIZES the payload against a whitelist schema — claim text
//      can never reach the payload (see evidenceEvents.schemas.ts).
//   2. Looks up the org's webhook subscriptions and fans the event out through the
//      EXISTING webhook subsystem (lib/webhooks/dispatch) — this module never
//      talks HTTP itself and never edits the webhook subsystem.
//   3. Records one row in evidence_events as the org-scoped, append-only source
//      log of what was emitted and how far it fanned out.
//
// Every operation is org-scoped: org_id is always the first predicate and is
// taken from the trusted caller context, never from client input. Best-effort by
// design: a webhook/log failure must never break the pipeline that emitted the
// event, so the emit is wrapped and returns a zeroed result on any failure.

export interface EmitEvidenceEventResult {
  ok: boolean;
  eventType: EvidenceEventType;
  matched: number; // active webhooks subscribed to this event type
  delivered: number; // deliveries that returned 2xx
  failed: number; // deliveries that failed / timed out
  logged: boolean; // whether the evidence_events row was written
}

interface EvidenceEventRow {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  data: unknown;
  matched: number;
  delivered: number;
  failed: number;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Coerce a jsonb column back through the whitelist schema on read, so even a row
// written by an older/looser code path cannot surface claim text on the log API.
function safeData(value: unknown): EvidenceEventData {
  const parsed = evidenceEventDataSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function mapRow(row: EvidenceEventRow): EvidenceEventLogEntry {
  return {
    id: row.id,
    eventType: row.event_type as EvidenceEventType,
    entityType: row.entity_type,
    entityId: row.entity_id,
    data: safeData(row.data),
    matched: Number(row.matched ?? 0),
    delivered: Number(row.delivered ?? 0),
    failed: Number(row.failed ?? 0),
    createdAt: toIso(row.created_at),
  };
}

// Records the emitted event in the org-scoped log. Best-effort: a logging failure
// must not fail the emit it is recording (mirrors lib/audit + recordDelivery).
async function logEmitted(
  pool: Pool,
  orgId: string,
  input: EmitEvidenceEventInput,
  data: EvidenceEventData,
  dispatch: DispatchResult,
  matched: number
): Promise<boolean> {
  try {
    await pool.query(
      `insert into evidence_events
         (org_id, event_type, entity_type, entity_id, data, matched, delivered, failed)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        orgId,
        input.type,
        input.entityType,
        input.entityId,
        JSON.stringify(data),
        matched,
        dispatch.delivered,
        dispatch.failed,
      ]
    );
    return true;
  } catch {
    return false;
  }
}

// Emits an evidence-lifecycle event for an org: sanitize -> fan out to matching
// webhooks -> record in the org's event log. Never throws.
export async function emitEvidenceEvent(
  pool: Pool,
  orgId: string,
  input: EmitEvidenceEventInput
): Promise<EmitEvidenceEventResult> {
  const parsed = emitEvidenceEventSchema.safeParse(input);
  if (!parsed.success) {
    // Invalid input is a programming error at the call site, but this is a
    // best-effort emitter — surface a zeroed result rather than throwing into
    // the pipeline.
    return {
      ok: false,
      eventType: (input?.type as EvidenceEventType) ?? "evidence.verified",
      matched: 0,
      delivered: 0,
      failed: 0,
      logged: false,
    };
  }

  const clean = parsed.data;
  // The schema already stripped unknown keys; `data` is guaranteed claim-free.
  const data: EvidenceEventData = clean.data ?? {};

  try {
    // How many active endpoints subscribe to this event type — the "matched"
    // count, distinct from delivery outcome. Uses the existing org-scoped repo.
    const targets = await listActiveWebhooksForEvent(pool, orgId, clean.type);
    const matched = targets.length;

    // Fan out through the existing webhook subsystem. dispatchEvent is itself
    // best-effort and records each attempt in webhook_deliveries. The payload it
    // sends is exactly the sanitized metadata below — never claim text.
    const dispatch = await dispatchEvent(orgId, clean.type, {
      entity_type: clean.entityType,
      entity_id: clean.entityId,
      ...data,
    });

    const logged = await logEmitted(pool, orgId, clean, data, dispatch, matched);

    return {
      ok: true,
      eventType: clean.type,
      matched,
      delivered: dispatch.delivered,
      failed: dispatch.failed,
      logged,
    };
  } catch {
    // Any unexpected failure: do not break the emitting pipeline.
    return {
      ok: false,
      eventType: clean.type,
      matched: 0,
      delivered: 0,
      failed: 0,
      logged: false,
    };
  }
}

// Org-scoped count of emitted evidence events, for pagination meta.
export async function countEvidenceEvents(
  pool: Pool,
  orgId: string,
  eventType?: string
): Promise<number> {
  const values: unknown[] = [orgId];
  let where = "org_id = $1";
  if (eventType) {
    values.push(eventType);
    where += ` and event_type = $${values.length}`;
  }
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from evidence_events where ${where}`,
    values
  );
  return rows[0]?.n ?? 0;
}

// Org-scoped, paginated recent emitted evidence events (newest first). Optional
// event_type filter. org_id is always the first predicate.
export async function listEvidenceEvents(
  pool: Pool,
  orgId: string,
  params: { limit: number; offset: number; eventType?: string }
): Promise<EvidenceEventLogEntry[]> {
  const values: unknown[] = [orgId];
  let where = "org_id = $1";
  if (params.eventType) {
    values.push(params.eventType);
    where += ` and event_type = $${values.length}`;
  }
  values.push(params.limit, params.offset);
  const { rows } = await pool.query<EvidenceEventRow>(
    `select id, event_type, entity_type, entity_id, data, matched, delivered, failed, created_at
       from evidence_events
      where ${where}
      order by created_at desc
      limit $${values.length - 1} offset $${values.length}`,
    values
  );
  return rows.map(mapRow);
}
