// Living-evidence monitor: org-scoped repository + the deterministic FLIP
// assessment that powers the "would the pooled verdict change?" verdict.
//
// The repository stores monitors and their event log. Governance invariant
// (mirrored in migration 0069): only numeric estimates / ids / counts are ever
// persisted in the jsonb payloads — never claim or source raw text. logEvent calls
// here follow the same rule (ids/counts only).
//
// assessLivingEvidence is the numeric core: given a BASELINE pool of studies and a
// single CANDIDATE new study, it deterministically decides whether adding the
// candidate would flip the pooled verdict (direction or significance), strengthen
// it, weaken it, or leave it unchanged. metaAnalyze does all the pooling; no LLM is
// in the decision.

import { z } from "zod";
import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { logEvent } from "@/lib/logger";
import {
  metaAnalyze,
  type StudyEffectInput,
  type PooledEstimate,
} from "@/lib/metaAnalysis";
import {
  cumulativeMetaAnalysis,
  directionOf,
  type CumulativeMetaResult,
  type DatedStudyInput,
  type EffectDirection,
} from "./cumulativeMeta";

// ---------------------------------------------------------------------------
// Boundary schemas (validated before anything numeric or persisted runs).
// ---------------------------------------------------------------------------

const ratioMeasureSchema = z.enum(["RR", "HR", "OR"]);

// One study as the caller supplies it: EITHER point + CI OR the four 2x2 counts.
// Matches lib/metaAnalysis StudyEffectInput; the numeric guardrails live there.
export const studyEffectSchema = z.object({
  label: z.string().min(1).max(200),
  measure: ratioMeasureSchema,
  point: z.number().finite().positive().nullish(),
  ciLower: z.number().finite().positive().nullish(),
  ciUpper: z.number().finite().positive().nullish(),
  ciPct: z.number().finite().gt(0).lt(100).nullish(),
  events1: z.number().finite().nonnegative().nullish(),
  total1: z.number().finite().positive().nullish(),
  events2: z.number().finite().nonnegative().nullish(),
  total2: z.number().finite().positive().nullish(),
});

export const datedStudySchema = studyEffectSchema.extend({
  year: z.number().int().finite(),
});

// Assess request: a time-ordered body of studies plus one candidate new study.
export const assessRequestSchema = z.object({
  studies: z.array(datedStudySchema).min(1).max(200),
  candidate: datedStudySchema,
});
export type AssessRequest = z.infer<typeof assessRequestSchema>;

// Create-monitor request (org-scoped route body).
export const createMonitorSchema = z.object({
  topic: z.string().min(4).max(500),
  query: z.string().max(1000).nullish(),
  baseline: z.array(datedStudySchema).max(200).nullish(),
});
export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;

// ---------------------------------------------------------------------------
// Repository types
// ---------------------------------------------------------------------------

export interface LivingEvidenceMonitor {
  id: string;
  orgId: string;
  topic: string;
  query: string | null;
  baseline: DatedStudyInput[] | null;
  lastCheckedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface LivingEvidenceEvent {
  id: string;
  monitorId: string;
  kind: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Assessment (deterministic flip verdict)
// ---------------------------------------------------------------------------

export type FlipVerdict =
  | "would_flip"
  | "strengthens"
  | "weakens"
  | "no_change"
  | "insufficient_evidence";

export interface AssessmentResult {
  verdict: FlipVerdict;
  // The pooled random-effects estimate BEFORE the candidate is added (null when
  // fewer than two usable baseline studies exist).
  baseline: PooledEstimate | null;
  baselineDirection: EffectDirection;
  baselineSignificant: boolean;
  // The pooled estimate AFTER the candidate is added.
  updated: PooledEstimate | null;
  updatedDirection: EffectDirection;
  updatedSignificant: boolean;
  // Which dimension(s) changed.
  flippedDirection: boolean;
  flippedSignificance: boolean;
  // The full cumulative trajectory of baseline + candidate, time-ordered, for the
  // timeline UI.
  cumulative: CumulativeMetaResult;
  rationale: string;
}

// Signed distance of the pooled log-effect from the null, in SE units. This is the
// magnitude we compare to decide strengthens vs weakens when no flip occurs.
function poolPrecisionZ(pooled: PooledEstimate | null): number {
  if (!pooled || pooled.se <= 0 || !Number.isFinite(pooled.se)) return 0;
  return Math.abs(pooled.logPoint) / pooled.se;
}

/**
 * Deterministically assess whether adding `candidate` to the `baseline` body of
 * studies would flip the pooled verdict. Pure: does not mutate inputs, no LLM.
 *
 *   - insufficient_evidence  fewer than two usable studies AFTER adding the
 *                            candidate — an honest "cannot pool" rather than a
 *                            forced answer.
 *   - would_flip             the pooled DIRECTION or SIGNIFICANCE changes when the
 *                            candidate is added.
 *   - strengthens            no flip, but the pooled effect moves further from the
 *                            null (|Z| increases) — the new study reinforces it.
 *   - weakens                no flip, but the pooled effect moves toward the null
 *                            (|Z| decreases) — the new study erodes it.
 *   - no_change              no flip and effectively no movement.
 */
export function assessLivingEvidence(input: AssessRequest): AssessmentResult {
  const { studies, candidate } = assessRequestSchema.parse(input);

  const baselineStudies: DatedStudyInput[] = studies.map(normalizeStudy);
  const candidateStudy = normalizeStudy(candidate);

  const baselineMeta = metaAnalyze(baselineStudies);
  const baseline = baselineMeta?.random ?? null;
  const baselineDirection = directionOf(baseline);
  const baselineSignificant = baseline ? baseline.significant : false;

  const updatedStudies = [...baselineStudies, candidateStudy];
  const updatedMeta = metaAnalyze(updatedStudies);
  const updated = updatedMeta?.random ?? null;
  const updatedDirection = directionOf(updated);
  const updatedSignificant = updated ? updated.significant : false;

  const cumulative = cumulativeMetaAnalysis(updatedStudies);

  // Honest insufficient: no poolable body even after the candidate.
  if (!updated) {
    return {
      verdict: "insufficient_evidence",
      baseline,
      baselineDirection,
      baselineSignificant,
      updated,
      updatedDirection,
      updatedSignificant,
      flippedDirection: false,
      flippedSignificance: false,
      cumulative,
      rationale:
        "Fewer than two poolable studies even after the candidate is added — the " +
        "pooled verdict cannot be computed. Returning an honest insufficient rather " +
        "than a forced low-confidence answer.",
    };
  }

  // A flip is only defined relative to an existing baseline pool.
  const flippedDirection =
    baseline !== null &&
    updatedDirection !== baselineDirection &&
    updatedDirection !== "null" &&
    baselineDirection !== "null";
  const flippedSignificance =
    baseline !== null && updatedSignificant !== baselineSignificant;

  let verdict: FlipVerdict;
  let rationale: string;

  const updatedZ = poolPrecisionZ(updated);
  const baselineZ = poolPrecisionZ(baseline);
  const zDelta = updatedZ - baselineZ;

  if (!baseline) {
    // The candidate created the first poolable body: establishes, not flips.
    verdict = updatedSignificant ? "strengthens" : "no_change";
    rationale =
      `The baseline had no poolable body; adding the candidate establishes a pooled ` +
      `estimate of ${fmtEstimate(updated)} (${updatedDirection}` +
      `${updatedSignificant ? ", significant" : ", not significant"}).`;
  } else if (flippedDirection || flippedSignificance) {
    verdict = "would_flip";
    const parts: string[] = [];
    if (flippedDirection) {
      parts.push(`direction ${baselineDirection} → ${updatedDirection}`);
    }
    if (flippedSignificance) {
      parts.push(
        `significance ${baselineSignificant ? "significant" : "not significant"} → ` +
          `${updatedSignificant ? "significant" : "not significant"}`
      );
    }
    rationale =
      `Adding the candidate would FLIP the pooled verdict (${parts.join("; ")}). ` +
      `Pool moves from ${fmtEstimate(baseline)} to ${fmtEstimate(updated)}.`;
  } else if (Math.abs(zDelta) < 0.05) {
    verdict = "no_change";
    rationale =
      `The candidate leaves the pooled verdict unchanged (${fmtEstimate(updated)}, ` +
      `${updatedDirection}${updatedSignificant ? ", significant" : ", not significant"}); ` +
      `precision is essentially unchanged.`;
  } else if (zDelta > 0) {
    verdict = "strengthens";
    rationale =
      `The candidate STRENGTHENS the pooled effect: it moves further from the null ` +
      `(|Z| ${baselineZ.toFixed(2)} → ${updatedZ.toFixed(2)}) while staying ` +
      `${updatedDirection} (${fmtEstimate(updated)}).`;
  } else {
    verdict = "weakens";
    rationale =
      `The candidate WEAKENS the pooled effect: it moves toward the null ` +
      `(|Z| ${baselineZ.toFixed(2)} → ${updatedZ.toFixed(2)}) while staying ` +
      `${updatedDirection} (${fmtEstimate(updated)}).`;
  }

  return {
    verdict,
    baseline,
    baselineDirection,
    baselineSignificant,
    updated,
    updatedDirection,
    updatedSignificant,
    flippedDirection,
    flippedSignificance,
    cumulative,
    rationale,
  };
}

function fmtEstimate(p: PooledEstimate): string {
  return `${p.point} [${p.ciLower}, ${p.ciUpper}]`;
}

// Strip any nullish optional fields to undefined so they satisfy the
// StudyEffectInput shape (which uses `number | null | undefined`). Pure copy.
function normalizeStudy(s: z.infer<typeof datedStudySchema>): DatedStudyInput {
  return {
    label: s.label,
    measure: s.measure,
    point: s.point ?? null,
    ciLower: s.ciLower ?? null,
    ciUpper: s.ciUpper ?? null,
    ciPct: s.ciPct ?? null,
    events1: s.events1 ?? null,
    total1: s.total1 ?? null,
    events2: s.events2 ?? null,
    total2: s.total2 ?? null,
    year: s.year,
  };
}

// ---------------------------------------------------------------------------
// Repository (org-scoped, parameterized SQL)
// ---------------------------------------------------------------------------

interface MonitorRow {
  id: string;
  org_id: string;
  topic: string;
  query: string | null;
  baseline: unknown;
  last_checked_at: Date | string | null;
  created_by: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapMonitor(row: MonitorRow): LivingEvidenceMonitor {
  return {
    id: row.id,
    orgId: row.org_id,
    topic: row.topic,
    query: row.query ?? null,
    baseline: Array.isArray(row.baseline)
      ? (row.baseline as DatedStudyInput[])
      : null,
    lastCheckedAt: toIso(row.last_checked_at),
    createdBy: row.created_by ?? null,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

/**
 * List an org's living-evidence monitors, newest-first, paginated. Returns the
 * page and the total count so the caller can build pagination meta.
 */
export async function listMonitors(
  orgId: string,
  limit: number,
  offset: number,
  pool: Pool = getPool()
): Promise<{ items: LivingEvidenceMonitor[]; total: number }> {
  const [{ rows }, count] = await Promise.all([
    pool.query<MonitorRow>(
      `select id, org_id, topic, query, baseline, last_checked_at, created_by, created_at
         from living_evidence_monitors
        where org_id = $1
        order by created_at desc
        limit $2 offset $3`,
      [orgId, limit, offset]
    ),
    pool.query<{ count: string }>(
      `select count(*)::text as count from living_evidence_monitors where org_id = $1`,
      [orgId]
    ),
  ]);
  return {
    items: rows.map(mapMonitor),
    total: Number(count.rows[0]?.count ?? "0"),
  };
}

/**
 * Create a monitor for an org. Baseline studies are stored as jsonb (numeric
 * estimates only — never claim text). Records a `created` event on the same
 * connection is unnecessary; the route records events explicitly.
 */
export async function createMonitor(
  orgId: string,
  createdBy: string,
  input: CreateMonitorInput,
  pool: Pool = getPool()
): Promise<LivingEvidenceMonitor> {
  const parsed = createMonitorSchema.parse(input);
  const baselineJson = parsed.baseline ? JSON.stringify(parsed.baseline) : null;

  const { rows } = await pool.query<MonitorRow>(
    `insert into living_evidence_monitors (org_id, topic, query, baseline, created_by)
     values ($1, $2, $3, $4::jsonb, $5)
     returning id, org_id, topic, query, baseline, last_checked_at, created_by, created_at`,
    [orgId, parsed.topic, parsed.query ?? null, baselineJson, createdBy]
  );
  const monitor = mapMonitor(rows[0]);

  logEvent("living_evidence.monitor.created", {
    orgId,
    monitorId: monitor.id,
    baselineCount: parsed.baseline?.length ?? 0,
  });

  return monitor;
}

/**
 * Load a single monitor scoped to its org (returns null if it does not belong to
 * the org — never leaks another org's monitor).
 */
export async function getMonitor(
  orgId: string,
  monitorId: string,
  pool: Pool = getPool()
): Promise<LivingEvidenceMonitor | null> {
  const { rows } = await pool.query<MonitorRow>(
    `select id, org_id, topic, query, baseline, last_checked_at, created_by, created_at
       from living_evidence_monitors
      where org_id = $1 and id = $2
      limit 1`,
    [orgId, monitorId]
  );
  return rows.length ? mapMonitor(rows[0]) : null;
}

/**
 * Append an event to a monitor's history. `detail` must carry ids/counts/numeric
 * estimates only — never claim or source text. Verified against the monitor's org
 * before writing so an event can never be attached to another org's monitor.
 */
export async function recordEvent(
  orgId: string,
  monitorId: string,
  kind: string,
  detail: Record<string, unknown>,
  pool: Pool = getPool()
): Promise<LivingEvidenceEvent | null> {
  const owner = await getMonitor(orgId, monitorId, pool);
  if (!owner) return null;

  const { rows } = await pool.query<{
    id: string;
    monitor_id: string;
    kind: string | null;
    detail: unknown;
    created_at: Date | string;
  }>(
    `insert into living_evidence_events (monitor_id, kind, detail)
     values ($1, $2, $3::jsonb)
     returning id, monitor_id, kind, detail, created_at`,
    [monitorId, kind, JSON.stringify(detail)]
  );

  await pool.query(
    `update living_evidence_monitors set last_checked_at = now() where id = $1 and org_id = $2`,
    [monitorId, orgId]
  );

  const row = rows[0];
  logEvent("living_evidence.event.recorded", { orgId, monitorId, kind });

  return {
    id: row.id,
    monitorId: row.monitor_id,
    kind: row.kind ?? null,
    detail:
      row.detail && typeof row.detail === "object"
        ? (row.detail as Record<string, unknown>)
        : null,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

/**
 * List a monitor's events, newest-first. Org-scoped: returns an empty list if the
 * monitor does not belong to the org.
 */
export async function listEvents(
  orgId: string,
  monitorId: string,
  limit: number,
  offset: number,
  pool: Pool = getPool()
): Promise<LivingEvidenceEvent[]> {
  const owner = await getMonitor(orgId, monitorId, pool);
  if (!owner) return [];

  const { rows } = await pool.query<{
    id: string;
    monitor_id: string;
    kind: string | null;
    detail: unknown;
    created_at: Date | string;
  }>(
    `select id, monitor_id, kind, detail, created_at
       from living_evidence_events
      where monitor_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [monitorId, limit, offset]
  );

  return rows.map((row) => ({
    id: row.id,
    monitorId: row.monitor_id,
    kind: row.kind ?? null,
    detail:
      row.detail && typeof row.detail === "object"
        ? (row.detail as Record<string, unknown>)
        : null,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  }));
}
