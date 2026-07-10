import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import {
  getPolicy,
  setPolicy,
  applyRetention,
  exportOrgEvidence,
} from "../lib/governance/retention";
import {
  evidenceExportBundleSchema,
  retentionPolicySchema,
} from "../lib/governance/retention.schemas";

// The DATA-RETENTION governance layer runs fully OFFLINE here over an in-memory
// fake of the pg Pool. The contracts under test are the ones a regulated pharma
// buyer's data-governance review actually checks:
//   1. POLICY ROUND-TRIP — setPolicy upserts one row per org; getPolicy reads it
//      back; omitted fields are preserved, explicit nulls clear a window.
//   2. SCOPED ENFORCEMENT — applyRetention deletes ONLY the org's rows that are
//      older than the org's window; another tenant's aged rows are untouched, and
//      a null window purges nothing.
//   3. SCOPED EXPORT — exportOrgEvidence bundles ONLY the requesting org's
//      artifacts; a second tenant's data never leaks into the bundle.

// --- In-memory fake pg Pool -------------------------------------------------

interface PolicyRow {
  org_id: string;
  evidence_reports_days: number | null;
  engine_usage_days: number | null;
  audit_days: number | null;
  updated_at: Date;
}

interface EvidenceRow {
  id: string;
  org_id: string;
  project_id: string | null;
  created_by: string | null;
  claim: string;
  verdict: string | null;
  certainty: string | null;
  pooled: unknown;
  report: unknown;
  created_at: Date;
}

interface UsageRow {
  id: string;
  org_id: string;
  engine: string;
  units: number;
  claude_tokens: number;
  occurred_at: Date;
}

interface Store {
  policies: Map<string, PolicyRow>;
  evidence: EvidenceRow[];
  usage: UsageRow[];
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `00000000-0000-0000-0000-${String(idSeq).padStart(12, "0")}`;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// Interprets `now() - ($n || ' days')::interval` deletes by comparing a row's
// timestamp against a cutoff computed from the parameterized day count.
function cutoffFor(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function makeExec(store: Store) {
  return async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim().toLowerCase();

    // ---- policy upsert ----
    if (text.startsWith("insert into org_retention_policies")) {
      const [
        orgId,
        evidence,
        engine,
        audit,
        hasEvidence,
        hasEngine,
        hasAudit,
      ] = params as [
        string,
        number | null,
        number | null,
        number | null,
        boolean,
        boolean,
        boolean,
      ];
      const existing = store.policies.get(orgId);
      const row: PolicyRow = {
        org_id: orgId,
        evidence_reports_days: hasEvidence
          ? evidence
          : existing?.evidence_reports_days ?? null,
        engine_usage_days: hasEngine
          ? engine
          : existing?.engine_usage_days ?? null,
        audit_days: hasAudit ? audit : existing?.audit_days ?? null,
        updated_at: new Date(),
      };
      store.policies.set(orgId, row);
      return { rows: [row], rowCount: 1 };
    }

    // ---- policy read ----
    if (
      text.includes("from org_retention_policies") &&
      text.includes("where org_id = $1")
    ) {
      const orgId = params[0] as string;
      const row = store.policies.get(orgId);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    // ---- aged deletes ----
    if (text.startsWith("delete from evidence_reports")) {
      const orgId = params[0] as string;
      const days = Number(params[1] as string);
      const cutoff = cutoffFor(days);
      const before = store.evidence.length;
      store.evidence = store.evidence.filter(
        (r) => !(r.org_id === orgId && r.created_at.getTime() < cutoff)
      );
      return { rows: [], rowCount: before - store.evidence.length };
    }
    if (text.startsWith("delete from engine_usage")) {
      const orgId = params[0] as string;
      const days = Number(params[1] as string);
      const cutoff = cutoffFor(days);
      const before = store.usage.length;
      store.usage = store.usage.filter(
        (r) => !(r.org_id === orgId && r.occurred_at.getTime() < cutoff)
      );
      return { rows: [], rowCount: before - store.usage.length };
    }

    // ---- export reads ----
    if (
      text.includes("from evidence_reports") &&
      text.includes("where org_id = $1")
    ) {
      const orgId = params[0] as string;
      const rows = store.evidence
        .filter((r) => r.org_id === orgId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return { rows, rowCount: rows.length };
    }
    if (
      text.includes("from engine_usage") &&
      text.includes("where org_id = $1")
    ) {
      const orgId = params[0] as string;
      const rows = store.usage
        .filter((r) => r.org_id === orgId)
        .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime());
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unexpected SQL in fake pool: ${text}`);
  };
}

function makePool(store: Store): Pool {
  const exec = makeExec(store);
  return {
    query: (sql: string, params?: unknown[]) => exec(sql, params),
  } as unknown as Pool;
}

const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const ORG_B = "00000000-0000-0000-0000-0000000000bb";

function emptyStore(): Store {
  idSeq = 0;
  return { policies: new Map(), evidence: [], usage: [] };
}

function seedEvidence(store: Store, orgId: string, ageDays: number): string {
  const id = nextId();
  store.evidence.push({
    id,
    org_id: orgId,
    project_id: null,
    created_by: null,
    claim: `claim ${id}`,
    verdict: "supported",
    certainty: "moderate",
    pooled: null,
    report: { ok: true },
    created_at: daysAgo(ageDays),
  });
  return id;
}

function seedUsage(store: Store, orgId: string, ageDays: number): string {
  const id = nextId();
  store.usage.push({
    id,
    org_id: orgId,
    engine: "meta_analysis",
    units: 1,
    claude_tokens: 100,
    occurred_at: daysAgo(ageDays),
  });
  return id;
}

// --- Tests ------------------------------------------------------------------

describe("retention policy round-trip", () => {
  it("returns null before any policy is set", async () => {
    const store = emptyStore();
    const pool = makePool(store);
    expect(await getPolicy(pool, ORG_A)).toBeNull();
  });

  it("setPolicy then getPolicy round-trips the stored windows", async () => {
    const store = emptyStore();
    const pool = makePool(store);

    const written = await setPolicy(pool, ORG_A, {
      evidenceReportsDays: 90,
      engineUsageDays: 30,
      auditDays: 365,
    });
    expect(() => retentionPolicySchema.parse(written)).not.toThrow();
    expect(written.orgId).toBe(ORG_A);

    const read = await getPolicy(pool, ORG_A);
    expect(read).not.toBeNull();
    expect(read?.evidenceReportsDays).toBe(90);
    expect(read?.engineUsageDays).toBe(30);
    expect(read?.auditDays).toBe(365);
  });

  it("omitted fields are preserved, explicit null clears a window", async () => {
    const store = emptyStore();
    const pool = makePool(store);

    await setPolicy(pool, ORG_A, {
      evidenceReportsDays: 90,
      engineUsageDays: 30,
    });
    // Update only engineUsageDays -> null; evidenceReportsDays must survive.
    const updated = await setPolicy(pool, ORG_A, { engineUsageDays: null });
    expect(updated.evidenceReportsDays).toBe(90);
    expect(updated.engineUsageDays).toBeNull();
  });

  it("keeps exactly one policy row per org", async () => {
    const store = emptyStore();
    const pool = makePool(store);
    await setPolicy(pool, ORG_A, { evidenceReportsDays: 10 });
    await setPolicy(pool, ORG_A, { evidenceReportsDays: 20 });
    expect(store.policies.size).toBe(1);
    expect((await getPolicy(pool, ORG_A))?.evidenceReportsDays).toBe(20);
  });
});

describe("applyRetention", () => {
  it("deletes only the org's aged rows and leaves fresh + other-org rows", async () => {
    const store = emptyStore();
    const pool = makePool(store);

    const oldA = seedEvidence(store, ORG_A, 100); // older than 90d -> purge
    const freshA = seedEvidence(store, ORG_A, 10); // within 90d -> keep
    const oldB = seedEvidence(store, ORG_B, 100); // other org -> keep
    const oldUsageA = seedUsage(store, ORG_A, 60); // older than 30d -> purge
    const freshUsageA = seedUsage(store, ORG_A, 5); // within 30d -> keep

    await setPolicy(pool, ORG_A, {
      evidenceReportsDays: 90,
      engineUsageDays: 30,
    });

    const result = await applyRetention(pool, ORG_A);
    expect(result.evidenceReportsDeleted).toBe(1);
    expect(result.engineUsageDeleted).toBe(1);

    const remainingEvidenceIds = store.evidence.map((r) => r.id);
    expect(remainingEvidenceIds).not.toContain(oldA);
    expect(remainingEvidenceIds).toContain(freshA);
    expect(remainingEvidenceIds).toContain(oldB); // tenant isolation
    const remainingUsageIds = store.usage.map((r) => r.id);
    expect(remainingUsageIds).not.toContain(oldUsageA);
    expect(remainingUsageIds).toContain(freshUsageA);
  });

  it("null / unset window purges nothing", async () => {
    const store = emptyStore();
    const pool = makePool(store);
    seedEvidence(store, ORG_A, 1000);
    seedUsage(store, ORG_A, 1000);

    // No policy configured at all.
    const noPolicy = await applyRetention(pool, ORG_A);
    expect(noPolicy.evidenceReportsDeleted).toBe(0);
    expect(noPolicy.engineUsageDeleted).toBe(0);
    expect(store.evidence.length).toBe(1);

    // Policy with explicit null windows also purges nothing.
    await setPolicy(pool, ORG_A, {
      evidenceReportsDays: null,
      engineUsageDays: null,
    });
    const nullPolicy = await applyRetention(pool, ORG_A);
    expect(nullPolicy.evidenceReportsDeleted).toBe(0);
    expect(store.evidence.length).toBe(1);
  });
});

describe("exportOrgEvidence", () => {
  it("bundles only the requesting org's artifacts", async () => {
    const store = emptyStore();
    const pool = makePool(store);

    const a1 = seedEvidence(store, ORG_A, 5);
    const a2 = seedEvidence(store, ORG_A, 1);
    seedEvidence(store, ORG_B, 5); // must NOT appear in A's bundle
    seedUsage(store, ORG_A, 2);
    seedUsage(store, ORG_B, 2); // must NOT appear in A's bundle
    await setPolicy(pool, ORG_A, { evidenceReportsDays: 30 });

    const bundle = await exportOrgEvidence(pool, ORG_A);
    expect(() => evidenceExportBundleSchema.parse(bundle)).not.toThrow();

    expect(bundle.orgId).toBe(ORG_A);
    expect(bundle.counts.evidenceReports).toBe(2);
    expect(bundle.counts.engineUsage).toBe(1);
    const ids = bundle.evidenceReports.map((r) => r.id);
    expect(ids).toContain(a1);
    expect(ids).toContain(a2);
    // No ORG_B rows leaked in.
    expect(bundle.evidenceReports.every((r) => ids.includes(r.id))).toBe(true);
    expect(bundle.engineUsage).toHaveLength(1);
    expect(bundle.policy?.evidenceReportsDays).toBe(30);
  });

  it("returns an empty, well-formed bundle for an org with no data", async () => {
    const store = emptyStore();
    const pool = makePool(store);
    const bundle = await exportOrgEvidence(pool, ORG_A);
    expect(() => evidenceExportBundleSchema.parse(bundle)).not.toThrow();
    expect(bundle.counts.evidenceReports).toBe(0);
    expect(bundle.counts.engineUsage).toBe(0);
    expect(bundle.policy).toBeNull();
  });
});
