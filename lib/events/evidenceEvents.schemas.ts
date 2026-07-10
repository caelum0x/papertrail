import { z } from "zod";

// Zod schemas + typed event catalogue for evidence-lifecycle webhooks.
//
// These events are emitted by the evidence pipeline (verification, dossier build/
// publish, signal detection) and fanned out to an org's subscribed webhooks via
// the existing webhook subsystem. The catalogue is deliberately small and
// explicit so subscription matching is a plain string compare and the developer
// portal can render a fixed checkbox list.
//
// GOVERNANCE: the payload `data` for these events must NEVER carry claim text —
// only ids and verdict/certainty metadata. The schema below is a whitelist: any
// field not named here is stripped before the event is emitted or logged. This
// is the trust boundary that lets an org's event log be exported to a regulated
// buyer without leaking claim content.

// The set of evidence-lifecycle events an org can subscribe a webhook to. Kept in
// sync with the webhook portal's checkbox list.
export const EVIDENCE_EVENT_TYPES = [
  "evidence.verified",
  "dossier.built",
  "dossier.published",
  "signal.detected",
] as const;

export type EvidenceEventType = (typeof EVIDENCE_EVENT_TYPES)[number];

export function isEvidenceEventType(value: string): value is EvidenceEventType {
  return (EVIDENCE_EVENT_TYPES as readonly string[]).includes(value);
}

// The entity an evidence event refers to. Soft reference — never dereferenced by
// this module, only carried through to the payload and log.
export const EVIDENCE_ENTITY_TYPES = [
  "verification",
  "evidence_report",
  "dossier",
  "signal",
] as const;

export type EvidenceEntityType = (typeof EVIDENCE_ENTITY_TYPES)[number];

// Whitelist of the ONLY fields permitted in an evidence-event payload. Everything
// is optional metadata; anything not listed here is dropped by `.strip()` so a
// caller can never smuggle claim text through the `data` bag. Explicitly note:
// there is no `claim`, `text`, `claim_text`, or `raw_text` field here, by design.
export const evidenceEventDataSchema = z
  .object({
    // Stable identifiers back to the producing entity / its context.
    verification_id: z.string().max(200).optional(),
    report_id: z.string().max(200).optional(),
    dossier_id: z.string().max(200).optional(),
    signal_id: z.string().max(200).optional(),
    project_id: z.string().max(200).optional(),
    source_id: z.string().max(200).optional(),
    // Verdict / grading metadata — enumerable, non-free-text signal about the
    // outcome. These are labels, not claim content.
    verdict: z.string().max(64).optional(),
    certainty: z.string().max(64).optional(),
    trust_band: z.string().max(64).optional(),
    discrepancy_type: z.string().max(64).optional(),
    signal_kind: z.string().max(64).optional(),
    severity: z.string().max(64).optional(),
    // Numeric scores — bounded, non-identifying.
    trust_score: z.number().finite().optional(),
    score: z.number().finite().optional(),
    version: z.number().int().nonnegative().optional(),
  })
  .strip();

export type EvidenceEventData = z.infer<typeof evidenceEventDataSchema>;

// Full validated input to emitEvidenceEvent. entity_type is constrained to the
// known set; entity_id is required so every event points at a concrete entity.
export const emitEvidenceEventSchema = z.object({
  type: z.enum(EVIDENCE_EVENT_TYPES),
  entityType: z.enum(EVIDENCE_ENTITY_TYPES),
  entityId: z.string().min(1).max(200),
  data: evidenceEventDataSchema.optional(),
});

export type EmitEvidenceEventInput = z.infer<typeof emitEvidenceEventSchema>;

// Shape returned in the org-scoped GET /api/events/evidence log.
export interface EvidenceEventLogEntry {
  id: string;
  eventType: EvidenceEventType;
  entityType: string;
  entityId: string;
  data: EvidenceEventData;
  matched: number;
  delivered: number;
  failed: number;
  createdAt: string;
}
