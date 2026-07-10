import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import {
  listEvidenceAudit,
  verifyEvidenceChain,
  type EvidenceAuditLink,
  type VerifyResult,
} from "@/lib/governance/evidenceAudit";

export const runtime = "nodejs";

interface AuditChainResponse {
  links: EvidenceAuditLink[];
  verification: VerifyResult;
}

// GET /api/governance/audit-chain — the calling org's tamper-evident evidence
// audit chain plus a live verification result. Read is a member-level action:
// there is no dedicated 'auditor' role in this RBAC model (owner/admin/editor/
// viewer), so any authenticated member of the org may inspect the chain. withOrg
// already guarantees membership and scopes every query to ctx.org.id — a caller
// can never read another tenant's chain, and no client-supplied org_id is
// trusted. Mutations to the chain happen only via appendEvidenceAudit invoked by
// evidence actions, never through this route.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();

    const [{ items, total }, verification] = await Promise.all([
      listEvidenceAudit(pool, ctx.org.id, { limit, offset }),
      verifyEvidenceChain(pool, ctx.org.id),
    ]);

    return ok<AuditChainResponse>(
      { links: items, verification },
      { total, page, limit }
    );
  } catch {
    return fail("Couldn't load the evidence audit chain. Please try again.", 500);
  }
});
