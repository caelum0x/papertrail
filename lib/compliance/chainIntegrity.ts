import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { verifyChain } from "@/lib/compliance/chain";
import { writeAudit } from "@/lib/audit";
import { recordControlRun } from "@/lib/complianceOps/runLedger";
import type { ChainIntegrityResult } from "@/lib/complianceOps/types";

// Nightly CHAIN-INTEGRITY sweep. The WORM audit chain (lib/compliance/chain.ts)
// already knows how to recompute and verify an org's hash chain via verifyChain;
// nothing scheduled ever ran it. This module runs it per org and turns a broken
// chain into DURABLE EVIDENCE rather than an exception:
//   * On a broken seq/hash it writes a HIGH-SEVERITY audit entry (via writeAudit)
//     naming the break location and reason — no chain contents, just the seq and
//     a short reason — and records a 'failed' control run.
//   * On a clean chain it records an 'ok' control run.
//   * It NEVER throws: a verification error (e.g. db failure) is captured as
//     `errored: true` in the result and recorded as a 'failed' run, so one org's
//     failure cannot abort a multi-org sweep.
//
// Org-scoped: verifyChain already filters by org_id; this module only ever passes
// the resolved server-side org id. Reuses the existing verify — no reimplementation.

// Verifies ONE org's audit chain and records the outcome. Returns a structured
// result; broken/errored chains are data, not thrown exceptions.
export async function checkOrgChainIntegrity(
  orgId: string,
  pool: Pool = getPool()
): Promise<ChainIntegrityResult> {
  let result: ChainIntegrityResult;

  try {
    const verification = await verifyChain(orgId, pool);
    result = {
      orgId,
      ok: verification.ok,
      length: verification.length,
      brokenAtSeq: verification.brokenAtSeq,
      reason: verification.reason,
      errored: false,
    };
  } catch (err) {
    // Verification itself failed (e.g. db error). Treat as a failed check, not a
    // thrown error — the sweep must continue for other orgs.
    result = {
      orgId,
      ok: false,
      length: 0,
      brokenAtSeq: null,
      reason: err instanceof Error ? err.message : "chain verification failed",
      errored: true,
    };
  }

  if (result.ok) {
    await recordControlRun(
      {
        orgId,
        control: "chain_integrity",
        status: "ok",
        detail: { length: result.length },
      },
      pool
    );
    return result;
  }

  // Broken (or errored) chain: write a high-severity audit + a failed run. Both
  // are best-effort (their helpers swallow their own errors) and carry only the
  // break location + a short reason — never chain contents.
  await writeAudit(pool, {
    orgId,
    userId: null,
    action: "compliance.chain_integrity.broken",
    entityType: "audit_chain",
    entityId: orgId,
    metadata: {
      severity: "high",
      errored: result.errored,
      broken_at_seq: result.brokenAtSeq,
      length: result.length,
      reason: result.reason,
    },
  });

  await recordControlRun(
    {
      orgId,
      control: "chain_integrity",
      status: "failed",
      reason: result.reason,
      detail: {
        broken_at_seq: result.brokenAtSeq,
        length: result.length,
        errored: result.errored,
      },
    },
    pool
  );

  return result;
}

export interface ChainIntegritySweep {
  orgsChecked: number;
  ok: number;
  broken: number;
  results: ChainIntegrityResult[];
}

// Runs the chain-integrity check across every provided org id. Best-effort:
// checkOrgChainIntegrity never throws, so a single org's failure is recorded and
// the sweep continues. Returns aggregate counts plus per-org results.
export async function sweepChainIntegrity(
  orgIds: readonly string[],
  pool: Pool = getPool()
): Promise<ChainIntegritySweep> {
  const results: ChainIntegrityResult[] = [];
  let okCount = 0;
  let brokenCount = 0;

  for (const orgId of orgIds) {
    const result = await checkOrgChainIntegrity(orgId, pool);
    results.push(result);
    if (result.ok) {
      okCount += 1;
    } else {
      brokenCount += 1;
    }
  }

  return {
    orgsChecked: orgIds.length,
    ok: okCount,
    broken: brokenCount,
    results,
  };
}
